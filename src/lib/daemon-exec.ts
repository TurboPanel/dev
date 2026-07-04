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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

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

function vendoredDenoUsable(): boolean {
  const direct = spawnSync("/bin/sh", ["-c", `test -x ${shellQuote(VENDORED_DENO_BIN)}`], {
    stdio: "ignore",
  });
  if (direct.status === 0) {
    return true;
  }
  const sudo = spawnSync("sudo", ["-n", "test", "-x", VENDORED_DENO_BIN], {
    stdio: "ignore",
  });
  return sudo.status === 0;
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

function denoRunBootstrapInvocation(denoBin: string): string {
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

/** Install Deno under vendor/deno (GitHub release zip + python3 stdlib extract). */
export async function ensureBootstrapDeno(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  if (lookupHostDenoBin() || vendoredDenoUsable()) {
    return;
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
    `DENO_BIN=${shellQuote(VENDORED_DENO_BIN)}`,
    'if [ -x "$DENO_BIN" ]; then exit 0; fi',
    `ASSET="deno-${triple}.zip"`,
    'URL="https://github.com/denoland/deno/releases/download/v${VERSION}/${ASSET}"',
    'TMP="$(mktemp -d)"',
    'DEST="$RUNTIMES_DIR/deno/$VERSION/deno"',
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
    'mkdir -p "$RUNTIMES_DIR/deno/bin"',
    'ln -sfn "$RUNTIMES_DIR/deno/$VERSION" "$RUNTIMES_DIR/deno/current"',
    'ln -sfn ../current/deno "$RUNTIMES_DIR/deno/bin/deno"',
    'rm -rf "$TMP"',
  ].join("\n");

  const code = await runCaptured(["sudo", "-n", "bash", "-c", installScript], onOutput);
  if (code !== 0 || !vendoredDenoUsable()) {
    throw new Error(`Failed to install Deno to ${VENDORED_DENO_BIN}`);
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
