import { accessSync, constants, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  DAEMON_BOOTSTRAP_SCRIPT,
  DAEMON_COMPILED,
  DAEMON_DENO_CONFIG,
  DAEMON_ORCHESTRATION_SCRIPT,
  DENO_VERSION,
  SYSTEM_DENO_BIN,
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

export function systemDenoInstalled(): boolean {
  const result = spawnSync("sudo", ["-n", "test", "-x", SYSTEM_DENO_BIN], {
    stdio: "ignore",
  });
  return result.status === 0;
}

/** Prefer host Deno, then the system binary at /usr/local/bin/deno. */
export function resolveBootstrapDenoBin(): string {
  const host = lookupHostDenoBin();
  if (host) {
    return host;
  }
  if (systemDenoInstalled()) {
    return SYSTEM_DENO_BIN;
  }
  throw new Error("Deno is not installed — install Deno on the host or via bootstrap");
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
    throw new Error("Failed to install unzip (required for Deno bootstrap)");
  }
}

/** Install Deno to /usr/local/bin/deno (same flow as deno-runtime Ansible role). */
export async function ensureBootstrapDeno(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  if (lookupHostDenoBin() || systemDenoInstalled()) {
    return;
  }

  await ensureUnzip(onOutput);

  const installScript = [
    "set -euo pipefail",
    `SYSTEM_DENO=${shellQuote(SYSTEM_DENO_BIN)}`,
    `VERSION=${shellQuote(DENO_VERSION)}`,
    'if [ -x "$SYSTEM_DENO" ]; then exit 0; fi',
    'DENO_TMP=$(mktemp -d)',
    'curl -fsSL https://deno.land/install.sh | DENO_INSTALL="$DENO_TMP" sh -s "v$VERSION" -- -y --no-modify-path',
    'install -m 0755 "$DENO_TMP/bin/deno" "$SYSTEM_DENO"',
    'rm -rf "$DENO_TMP"',
  ].join("\n");

  const code = await runCaptured(["sudo", "-n", "bash", "-c", installScript], onOutput);
  if (code !== 0 || !systemDenoInstalled()) {
    throw new Error("Failed to install Deno to /usr/local/bin/deno");
  }
}

function denoRunOrchestrationInvocation(denoBin: string, actionArgs: string[]): string {
  return [
    denoBin,
    "run",
    "--config",
    DAEMON_DENO_CONFIG,
    "--allow-read",
    "--allow-run",
    "--allow-env",
    "--allow-write",
    "--allow-net",
    DAEMON_ORCHESTRATION_SCRIPT,
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

/** Shell command to exec bootstrap-orchestration for the current runtime contract. */
export function bootstrapOrchestrationCommand(): string {
  if (existsSync(DAEMON_COMPILED) && isExecutable(DAEMON_COMPILED)) {
    return `${shellQuote(DAEMON_COMPILED)} bootstrap-orchestration`;
  }
  if (isProductionRuntime()) {
    return denoRunBootstrapInvocation(resolveProductionDenoBin());
  }
  return denoRunBootstrapInvocation(resolveBootstrapDenoBin());
}
