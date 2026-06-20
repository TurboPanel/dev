import React from "react";
import { Box, Text } from "ink";
import { canRestartDaemon } from "../lib/daemon-actions.ts";
import type { DaemonOperation } from "../lib/spinners.ts";
import { BORDER_COLOR } from "../theme.ts";

export function statusHints(
  activeAreaId: string,
  openServiceId?: string | null,
  installFinished?: boolean,
  daemonOperation?: DaemonOperation | null,
): string {
  if (activeAreaId === "services") {
    if (openServiceId === "daemon") {
      if (daemonOperation === "restart") {
        return installFinished
          ? "Enter OK · Ctrl-C exit"
          : "↑ ↓ Yes/No · Enter select · Esc cancel · Ctrl-C exit";
      }
      const restartHint = canRestartDaemon() ? " · R restart" : "";
      return `Esc back · Tab focus · ↑↓ scroll log · L level${restartHint} · Enter run · Ctrl-C exit`;
    }
    return openServiceId
      ? "Esc back · ↑ ↓ scroll log · Ctrl-C exit"
      : "← → switch tabs · ↑ ↓ select service · Enter focus log · Ctrl-C exit";
  }
  if (activeAreaId === "developer") {
    return "↑ ↓ choose action · Enter run · ← → switch tabs · Ctrl-C exit";
  }
  if (activeAreaId === "bootstrap") {
    return installFinished
      ? "Press any key to continue · Ctrl-C exit"
      : "Bootstrapping development environment · Ctrl-C exit";
  }
  return "← → switch tabs · Ctrl-C exit";
}

export function StatusBar({ width, status }: { width: number; status: string }) {
  const labelWidth = Math.min(status.length + 2, width - 4);
  const inner = width - 2;
  const dashTotal = Math.max(0, inner - labelWidth);
  const leftDashes = Math.floor(dashTotal / 2);
  const rightDashes = dashTotal - leftDashes;

  const maxLabelChars = Math.max(0, labelWidth - 2);
  const display =
    status.length > maxLabelChars
      ? status.slice(0, Math.max(0, maxLabelChars - 1)) + "…"
      : status;

  return (
    <Box flexDirection="row" width={width} height={1} flexShrink={0}>
      <Text color={BORDER_COLOR}>
        ╰{"─".repeat(leftDashes)}
      </Text>
      <Box
        width={labelWidth}
        height={1}
        justifyContent="center"
        paddingX={1}
      >
        <Text dimColor wrap="truncate">
          {display}
        </Text>
      </Box>
      <Text color={BORDER_COLOR}>
        {"─".repeat(rightDashes)}╯
      </Text>
    </Box>
  );
}
