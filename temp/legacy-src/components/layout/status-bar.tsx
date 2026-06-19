import React from "react";
import { Box, Text } from "ink";
import { ActionMenu, type ActionMenuItem } from "@turbopanel/components/action-menu.tsx";
import type { StackUnitStatus } from "@turbopanel/lib/stack-status.ts";
import type { DeveloperState } from "@turbopanel/hooks/use-developer-state.ts";

const UNIT_SHORT: Record<string, string> = {
  daemon: "dmn",
  caddy: "cad",
  "ui (Expo)": "ui",
};

function unitGlyph(active: boolean | null): string {
  return active === true ? "✓" : active === false ? "○" : "?";
}

function instanceStackLabel(
  unit: StackUnitStatus,
  instanceRuntime: "deno" | "workers",
): string {
  const mode = instanceRuntime === "workers" ? "wrk" : "deno";
  return `ins·${mode}${unitGlyph(unit.active)}`;
}

export function buildStatusSummary({
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
  const parts: string[] = [];

  if (!runtimeReady) {
    parts.push("console?");
  }

  if (!daemonPresent) {
    parts.push("daemon not installed");
    return parts.join(" · ");
  }

  const stackShort = stackUnits
    .map((unit) => {
      if (unit.unit === "turbopanel-instance") {
        return instanceStackLabel(unit, instanceRuntime);
      }
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

export function StatusBar({
  showMenu,
  menuItems,
  onMenuSelect,
  hints,
  statusSummary,
  columns,
  rows,
}: {
  showMenu: boolean;
  menuItems: ActionMenuItem[];
  onMenuSelect: (item: ActionMenuItem) => void;
  hints: string;
  statusSummary: string;
  columns: number;
  rows: number;
}) {
  if (showMenu) {
    return (
      <>
        <Text dimColor>Actions · ↑↓ select · Enter run · Esc cancel</Text>
        <ActionMenu items={menuItems} onSelect={onMenuSelect} />
      </>
    );
  }

  return (
    <Box flexDirection="row" width="100%">
      <Box flexGrow={1} minWidth={0}>
        <Text dimColor wrap="truncate">
          {statusSummary || "—"}
        </Text>
      </Box>
      <Text dimColor wrap="truncate">
        {" · "}{hints}{" · "}{columns}×{rows}
      </Text>
    </Box>
  );
}
