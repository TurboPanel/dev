import { DENO_VERSION } from "@turbopanel/paths";
import type { StackUnitStatus } from "@turbopanel/stack-status";
import type { DeveloperState } from "@turbopanel/use-developer-state";

const UNIT_SHORT: Record<string, string> = {
  daemon: "dmn",
  instance: "ins",
  caddy: "cad",
  "ui (Expo)": "ui",
};

function unitGlyph(active: boolean | null): string {
  return active === true ? "✓" : active === false ? "○" : "?";
}

export function buildCompactHeader({
  runtimeReady,
  daemonPresent,
  stackUnits,
  instanceRuntime,
  socketPresent,
  developerState,
}: {
  runtimeReady: boolean;
  daemonPresent: boolean;
  stackUnits: StackUnitStatus[];
  instanceRuntime: "deno" | "workers";
  socketPresent: boolean;
  developerState: DeveloperState | null;
}): string {
  const parts: string[] = ["TurboPanel"];
  parts.push(runtimeReady ? `deno${DENO_VERSION}` : "deno?");

  if (!daemonPresent) {
    parts.push("daemon not installed · m menu");
    return parts.join(" · ");
  }

  const stackShort = stackUnits
    .map((unit) => {
      const short = UNIT_SHORT[unit.label] ?? unit.label;
      return `${short}${unitGlyph(unit.active)}`;
    })
    .join(" ");

  if (stackShort) parts.push(stackShort);

  if (instanceRuntime === "deno") {
    parts.push(`sock${socketPresent ? "✓" : "○"}`);
  }

  const recovery = developerState?.recovery;
  if (recovery?.active) {
    parts.push(`⟳ ${recovery.message}`);
    return parts.join(" · ");
  }

  if (developerState) {
    const api = developerState.healthOk;
    parts.push(
      api === true ? "api✓" : api === null ? "api…" : "api○",
    );
    parts.push(`${developerState.fleet.length}srv`);
    parts.push(developerState.targetLabel);
    if (developerState.error) {
      parts.push(developerState.error.slice(0, 48));
    }
  }

  return parts.join(" · ");
}
