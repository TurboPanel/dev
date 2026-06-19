import { readInstanceRuntime } from "@turbopanel/lib/instance-runtime.ts";
import {
  CADDY_HTTPS,
  WEBSITE_DEV_PORT,
  WRANGLER_DEV_PORT,
} from "@turbopanel/lib/paths.ts";

export type StackUnitStatus = {
  unit: string;
  label: string;
  active: boolean | null;
  detail: string;
};

const STACK_UNITS: Array<{ unit: string; label: string }> = [
  { unit: "turbopanel-daemon", label: "daemon" },
  { unit: "turbopanel-instance", label: "instance" },
  { unit: "turbopanel-caddy", label: "caddy" },
  { unit: "turbopanel-ui", label: "ui (Expo)" },
  { unit: "turbopanel-website", label: "website (Next.js)" },
];

function stackUnitsForRuntime(): Array<{ unit: string; label: string }> {
  return STACK_UNITS;
}

const INSTANCE_SOCKET = "/run/turbopanel/instance.sock";

function unitLoadState(unit: string): string {
  const proc = new Deno.Command("systemctl", {
    args: ["show", unit, "--property=LoadState", "--value"],
    stdout: "piped",
    stderr: "null",
  }).outputSync();
  return new TextDecoder().decode(proc.stdout).trim();
}

function websiteUnitDetail(active: boolean | null, detail: string): string {
  const url = `http://127.0.0.1:${WEBSITE_DEV_PORT}`;
  if (active === true) {
    return checkWebsiteDevHealth()
      ? `active — ${url}`
      : `active — ${url} (not responding)`;
  }
  if (active === null) {
    return "not installed — run Start dev stack";
  }
  return `${detail} — run Start dev stack`;
}

function systemctlIsActive(unit: string): { active: boolean | null; detail: string } {
  const proc = new Deno.Command("systemctl", {
    args: ["is-active", unit],
    stdout: "piped",
    stderr: "null",
  }).outputSync();

  const text = new TextDecoder().decode(proc.stdout).trim();
  if (proc.success && text === "active") {
    return { active: true, detail: "active" };
  }
  if (text === "inactive" || text === "failed") {
    return { active: false, detail: text };
  }
  if (text === "unknown" || proc.code === 4) {
    return { active: null, detail: "not installed" };
  }
  return { active: null, detail: text || `exit ${proc.code}` };
}

function curlHttpStatus(url: string, insecure = false): string {
  const args = insecure
    ? ["-sk", "-o", "/dev/null", "-w", "%{http_code}", url]
    : ["-s", "-o", "/dev/null", "-w", "%{http_code}", url];
  const proc = new Deno.Command("curl", {
    args,
    stdout: "piped",
    stderr: "null",
  }).outputSync();
  return new TextDecoder().decode(proc.stdout).trim();
}

export function instanceSocketPresent(): boolean {
  try {
    const stat = Deno.statSync(INSTANCE_SOCKET);
    return stat.isSocket === true;
  } catch {
    return false;
  }
}

export function wranglerProcessRunning(): boolean {
  const { active } = systemctlIsActive("turbopanel-instance");
  return active === true;
}

export function checkWebsiteDevHealth(): boolean {
  const code = curlHttpStatus(`http://127.0.0.1:${WEBSITE_DEV_PORT}/`);
  return code === "200" || code === "307" || code === "308";
}

export function checkInstanceApiHealth(): boolean {
  const caddyCode = curlHttpStatus(`${CADDY_HTTPS}/api/health`, true);
  if (caddyCode === "200") return true;
  const wranglerCode = curlHttpStatus(
    `http://127.0.0.1:${WRANGLER_DEV_PORT}/api/health`,
  );
  return wranglerCode === "200";
}

/** Whether the developer console can reach the instance API. */
export function instanceReachable(): boolean {
  const runtime = readInstanceRuntime();
  const socketPresent = instanceSocketPresent();
  const apiHealthy = runtime === "workers" ? checkInstanceApiHealth() : false;
  const reachable = runtime === "workers" ? apiHealthy : socketPresent;

  return reachable;
}

function parseIsActiveLine(text: string): { active: boolean | null; detail: string } {
  if (text === "active") {
    return { active: true, detail: "active" };
  }
  if (text === "inactive" || text === "failed") {
    return { active: false, detail: text };
  }
  if (text === "unknown") {
    return { active: null, detail: "not installed" };
  }
  return { active: null, detail: text || "unknown" };
}

export function fetchStackStatus(): StackUnitStatus[] {
  const unitNames = stackUnitsForRuntime().map((entry) => entry.unit);
  const proc = new Deno.Command("systemctl", {
    args: ["is-active", ...unitNames],
    stdout: "piped",
    stderr: "piped",
  }).outputSync();

  const stdout = new TextDecoder().decode(proc.stdout).trim();
  const stderr = new TextDecoder().decode(proc.stderr).trim();
  const lines = stdout
    ? stdout.split("\n")
    : stderr
    ? stderr.split("\n")
    : [];

  const units = stackUnitsForRuntime().map(({ unit, label }, index) => {
    const text = lines[index]?.trim() ?? "";
    const loadState = unitLoadState(unit);
    if (loadState === "not-found") {
      const detail = unit === "turbopanel-website"
        ? websiteUnitDetail(null, "not installed")
        : "not installed";
      return { unit, label, active: null, detail };
    }
    const { active, detail } = parseIsActiveLine(text);
    const resolvedDetail = unit === "turbopanel-website"
      ? websiteUnitDetail(active, detail)
      : detail;
    return { unit, label, active, detail: resolvedDetail };
  });

  return units;
}

export function stackSummary(units: StackUnitStatus[]): string {
  const activeCount = units.filter((unit) => unit.active === true).length;
  const knownCount = units.filter((unit) => unit.active !== null).length;
  if (knownCount === 0) {
    return "no systemd units detected";
  }
  if (activeCount === 0) {
    return "installed but not running — use Start dev stack";
  }
  if (activeCount === knownCount) {
    return `${activeCount}/${knownCount} units active`;
  }
  return `${activeCount}/${knownCount} units active — partial stack`;
}
