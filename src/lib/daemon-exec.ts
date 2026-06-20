import { accessSync, constants, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  DAEMON_BOOTSTRAP_COMPILED,
  DAEMON_BOOTSTRAP_SCRIPT,
  DAEMON_DENO_CONFIG,
  DENO_PINNED_BIN,
  DENO_VERSION,
  PLATFORM_DENO_BIN,
  RUNTIMES_DIR,
} from "./paths.ts";
import { type InstallOutputHandler, runCaptured } from "./install-output.ts";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
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

export function platformDenoInstalled(): boolean {
  const result = spawnSync("sudo", ["-n", "test", "-x", PLATFORM_DENO_BIN], {
    stdio: "ignore",
  });
  return result.status === 0;
}

/** Prefer host Deno, then the vendored platform runtime under /opt/turbopanel/runtimes/deno. */
export function resolveBootstrapDenoBin(): string {
  const host = lookupHostDenoBin();
  if (host) {
    return host;
  }
  if (platformDenoInstalled()) {
    return PLATFORM_DENO_BIN;
  }
  throw new Error("Deno bootstrap runtime is not installed");
}

function resolveProductionDenoBin(): string {
  return resolveBootstrapDenoBin();
}

function denoRunBootstrapInvocation(denoBin: string): string {
  return [
    denoBin,
    "run",
    "--config",
    DAEMON_DENO_CONFIG,
    "--allow-net",
    "--allow-read",
    "--allow-write",
    "--allow-run",
    "--allow-env",
    DAEMON_BOOTSTRAP_SCRIPT,
  ].map(shellQuote).join(" ");
}

function commandExists(name: string): boolean {
  const result = spawnSync(
    "/bin/sh",
    ["-c", 'command -v "$1" >/dev/null 2>&1', "_", name],
    { stdio: "ignore" },
  );
  return result.status === 0;
}

async function ensureUnzip(onOutput?: InstallOutputHandler): Promise<void> {
  if (commandExists("unzip") || commandExists("7z")) {
    return;
  }

  const code = await runCaptured([
    "sudo",
    "-n",
    "sh",
    "-c",
    "DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y unzip",
  ], onOutput);

  if (code !== 0 || (!commandExists("unzip") && !commandExists("7z"))) {
    throw new Error("Failed to install unzip (required for Deno bootstrap runtime)");
  }
}

/** Install vendored Deno into /opt/turbopanel/runtimes/deno (same flow as deno-runtime Ansible role). */
export async function ensureBootstrapDeno(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  if (lookupHostDenoBin() || platformDenoInstalled()) {
    return;
  }

  await ensureUnzip(onOutput);

  const denoTmp = `${RUNTIMES_DIR}/deno/.install`;
  const installScript = [
    "set -euo pipefail",
    `DENO_TMP=${shellQuote(denoTmp)}`,
    `RUNTIMES=${shellQuote(RUNTIMES_DIR)}`,
    `VERSION=${shellQuote(DENO_VERSION)}`,
    `PINNED=${shellQuote(DENO_PINNED_BIN)}`,
    'if [ -x "$PINNED" ]; then exit 0; fi',
    'rm -rf "$DENO_TMP"',
    'mkdir -p "$DENO_TMP"',
    'curl -fsSL https://deno.land/install.sh | DENO_INSTALL="$DENO_TMP" sh -s "v$VERSION" -- -y --no-modify-path',
    'install -d -m 0755 "$RUNTIMES/deno/$VERSION"',
    'mv "$DENO_TMP/bin/deno" "$PINNED"',
    'rm -rf "$DENO_TMP"',
    'ln -sfn "$RUNTIMES/deno/$VERSION" "$RUNTIMES/deno/current"',
    'if getent passwd turbopanel >/dev/null 2>&1; then chown -R turbopanel:turbopanel "$RUNTIMES/deno"; fi',
  ].join("\n");

  const code = await runCaptured(["sudo", "-n", "bash", "-c", installScript], onOutput);
  if (code !== 0 || !platformDenoInstalled()) {
    throw new Error("Failed to install Deno bootstrap runtime");
  }
}

/** Shell command to exec bootstrap-orchestration for the current runtime contract. */
export function bootstrapOrchestrationCommand(): string {
  if (isProductionRuntime()) {
    if (
      existsSync(DAEMON_BOOTSTRAP_COMPILED) &&
      isExecutable(DAEMON_BOOTSTRAP_COMPILED)
    ) {
      return shellQuote(DAEMON_BOOTSTRAP_COMPILED);
    }
    return denoRunBootstrapInvocation(resolveProductionDenoBin());
  }
  return denoRunBootstrapInvocation(resolveBootstrapDenoBin());
}
