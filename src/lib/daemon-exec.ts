import { spawnSync } from "node:child_process";
import {
  daemonBootstrapScript,
  daemonDenoConfig,
  daemonOrchestrationScript,
  DENO_VERSION,
  RUNTIMES_DIR,
  VENDORED_DENO_BIN,
} from "./paths.ts";
import { type InstallOutputHandler, runCaptured } from "./install-output.ts";
import { shellQuote } from "./shell-quote.ts";

/** True when the host runs the production runtime contract (compiled entrypoints). */
export function isProductionRuntime(): boolean {
  return process.env.TURBOPANEL_RUNTIME === "production";
}

/** Resolve Deno from the developer host PATH (not managed by turbopanel-dev). */
export function lookupHostDenoBin(): string | null {
  const result = spawnSync("/bin/sh", ["-c", "command -v deno"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const bin = (result.stdout ?? "").trim();
  if (result.status !== 0 || bin.length === 0) {
    return null;
  }
  return bin;
}

/** Resolve Deno from the developer host PATH (not managed by turbopanel-dev). */
export function resolveHostDenoBin(): string {
  const bin = lookupHostDenoBin();
  if (!bin) {
    throw new Error(
      "Deno is not on PATH — install Deno on the host for development bootstrap",
    );
  }
  return bin;
}

function pathIsExecutable(path: string): boolean {
  const direct = spawnSync("/bin/sh", ["-c", `test -x ${shellQuote(path)}`], {
    stdio: "ignore",
  });
  if (direct.status === 0) {
    return true;
  }
  const sudo = spawnSync("sudo", ["-n", "test", "-x", path], {
    stdio: "ignore",
  });
  return sudo.status === 0;
}

/** True when the pinned Deno binary exists under vendor/deno/<DENO_VERSION>/. */
function pinnedVendoredDenoUsable(): boolean {
  return pathIsExecutable(`${RUNTIMES_DIR}/deno/${DENO_VERSION}/deno`);
}

/** True when vendor/deno/current/deno resolves to an executable (any version). */
function vendoredDenoUsable(): boolean {
  return pathIsExecutable(VENDORED_DENO_BIN);
}

/** Prefer host Deno, then the vendored runtime at vendor/deno/current/deno. */
export function resolveBootstrapDenoBin(): string {
  const host = lookupHostDenoBin();
  if (host) {
    return host;
  }
  if (vendoredDenoUsable()) {
    return VENDORED_DENO_BIN;
  }
  throw new Error(
    "Deno is not installed — install Deno on the host or run stack converge to vendor it",
  );
}

function resolveProductionDenoBin(): string {
  return resolveBootstrapDenoBin();
}

function denoRunBootstrapInvocation(denoBin: string): string {
  return [
    denoBin,
    "run",
    "--config",
    daemonDenoConfig(),
    "--allow-net",
    "--allow-read",
    "--allow-write",
    "--allow-run",
    "--allow-env",
    daemonBootstrapScript(),
  ].map(shellQuote).join(" ");
}

function resolveDenoAssetTriple(): string {
  const arch = process.arch;
  switch (arch) {
    case "arm64":
      return "aarch64-unknown-linux-gnu";
    case "x64":
      return "x86_64-unknown-linux-gnu";
    default:
      throw new Error(`Unsupported CPU architecture for Deno bootstrap: ${arch}`);
  }
}

function hostPython3Available(): boolean {
  const result = spawnSync("/bin/sh", ["-c", "command -v python3"], {
    stdio: "ignore",
  });
  return result.status === 0;
}

/**
 * Install the pinned Deno under vendor/deno/<DENO_VERSION> and point
 * `current` / `bin/deno` at it (GitHub release zip + python3 stdlib extract).
 *
 * Host Deno on PATH short-circuits (dev preference). An older vendored
 * `current` alone is not enough — the pinned version must exist and the
 * symlinks must point at it (mirrors `tp_install_deno_runtime` in run.sh).
 */
export async function ensureBootstrapDeno(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  if (lookupHostDenoBin()) {
    return;
  }
  if (pinnedVendoredDenoUsable()) {
    // Repair drifted symlinks even when the pinned binary is already present.
    const linkScript = [
      "set -euo pipefail",
      `RUNTIMES_DIR=${shellQuote(RUNTIMES_DIR)}`,
      `VERSION=${shellQuote(DENO_VERSION)}`,
      'mkdir -p "$RUNTIMES_DIR/deno/bin"',
      'ln -sfn "$RUNTIMES_DIR/deno/$VERSION" "$RUNTIMES_DIR/deno/current"',
      'ln -sfn ../current/deno "$RUNTIMES_DIR/deno/bin/deno"',
    ].join("\n");
    const linkCode = await runCaptured(
      ["sudo", "-n", "bash", "-c", linkScript],
      onOutput,
    );
    if (linkCode === 0 && vendoredDenoUsable()) {
      return;
    }
  }

  if (!hostPython3Available()) {
    throw new Error(
      "Deno is not installed — install host Deno, vendor it via stack converge, " +
        "or install python3-minimal to extract the release zip",
    );
  }

  const triple = resolveDenoAssetTriple();
  const installScript = [
    "set -euo pipefail",
    `RUNTIMES_DIR=${shellQuote(RUNTIMES_DIR)}`,
    `VERSION=${shellQuote(DENO_VERSION)}`,
    'DEST="$RUNTIMES_DIR/deno/$VERSION/deno"',
    'if [ ! -x "$DEST" ]; then',
    `ASSET="deno-${triple}.zip"`,
    'URL="https://github.com/denoland/deno/releases/download/v${VERSION}/${ASSET}"',
    'TMP="$(mktemp -d)"',
    'curl -fsSL -o "$TMP/$ASSET" "$URL"',
    `python3 - "$TMP/$ASSET" "$DEST" <<'PY'
import shutil, sys, tempfile, zipfile
from pathlib import Path

archive, dest = Path(sys.argv[1]), Path(sys.argv[2])
dest.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="deno-zip-") as tmp:
    tmp_path = Path(tmp)
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(tmp_path)
    candidates = list(tmp_path.rglob("deno"))
    if not candidates:
        raise SystemExit("deno binary not found in release zip")
    shutil.copy2(candidates[0], dest)
dest.chmod(0o755)
PY`,
    'rm -rf "$TMP"',
    "fi",
    'mkdir -p "$RUNTIMES_DIR/deno/bin"',
    'ln -sfn "$RUNTIMES_DIR/deno/$VERSION" "$RUNTIMES_DIR/deno/current"',
    'ln -sfn ../current/deno "$RUNTIMES_DIR/deno/bin/deno"',
  ].join("\n");

  const code = await runCaptured(["sudo", "-n", "bash", "-c", installScript], onOutput);
  if (code !== 0 || !pinnedVendoredDenoUsable() || !vendoredDenoUsable()) {
    throw new Error(`Failed to install Deno ${DENO_VERSION} to ${VENDORED_DENO_BIN}`);
  }
}

function denoRunOrchestrationInvocation(denoBin: string, actionArgs: string[]): string {
  return [
    denoBin,
    "run",
    "--config",
    daemonDenoConfig(),
    "--allow-read",
    "--allow-run",
    "--allow-env",
    "--allow-write",
    "--allow-net",
    daemonOrchestrationScript(),
    ...actionArgs,
  ].map(shellQuote).join(" ");
}

/** Shell command to exec run-orchestration-action.ts for the current runtime contract. */
export function orchestrationActionCommand(...actionArgs: string[]): string {
  if (isProductionRuntime()) {
    return denoRunOrchestrationInvocation(resolveProductionDenoBin(), actionArgs);
  }
  return denoRunOrchestrationInvocation(resolveBootstrapDenoBin(), actionArgs);
}

/**
 * Shell command to exec bootstrap-orchestration for the current runtime contract.
 *
 * In dev the console always bootstraps orchestration **from the source checkout**
 * via Deno (`scripts/bootstrap-orchestration.ts`) — it never runs the compiled
 * `bin/turbopaneld` binary. That compiled entrypoint (and its
 * `bin/turbopaneld.js` fallback) only exists on managed/production installs,
 * which the dev console does not drive; bootstrap there is handled by
 * `run.sh` + Ansible, not this path.
 */
export function bootstrapOrchestrationCommand(): string {
  if (isProductionRuntime()) {
    return denoRunBootstrapInvocation(resolveProductionDenoBin());
  }
  return denoRunBootstrapInvocation(resolveBootstrapDenoBin());
}
