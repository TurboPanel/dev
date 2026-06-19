import { accessSync, constants, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  DAEMON_BOOTSTRAP_COMPILED,
  DAEMON_BOOTSTRAP_SCRIPT,
  DAEMON_DENO_CONFIG,
  PLATFORM_DENO_BIN,
} from "./paths.ts";

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
export function resolveHostDenoBin(): string {
  const result = spawnSync("/bin/sh", ["-c", "command -v deno"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const bin = (result.stdout ?? "").trim();
  if (result.status !== 0 || bin.length === 0) {
    throw new Error(
      "Deno is not on PATH — install Deno on the host for development bootstrap",
    );
  }
  return bin;
}

function resolveProductionDenoBin(): string {
  if (existsSync(PLATFORM_DENO_BIN) && isExecutable(PLATFORM_DENO_BIN)) {
    return PLATFORM_DENO_BIN;
  }
  return resolveHostDenoBin();
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
  return denoRunBootstrapInvocation(resolveHostDenoBin());
}
