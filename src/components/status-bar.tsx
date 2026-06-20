import React from "react";
import { Box, Text } from "ink";
import { readInstanceRuntime } from "../lib/daemon-env.ts";
import { isManagedService } from "../lib/service-actions.ts";
import { serviceSupportsOpen } from "../lib/service-urls.ts";
import { BORDER_COLOR } from "../theme.ts";

import type { PendingRestart } from "../hooks/use-console-app.ts";

function serviceActionHints(selectedServiceId?: string | null): string {
  if (!selectedServiceId || !isManagedService(selectedServiceId)) {
    return "";
  }

  const parts = ["R restart", "X disable", "E enable"];
  if (serviceSupportsOpen(selectedServiceId)) {
    parts.push("O open");
  }
  if (selectedServiceId === "instance") {
    if (readInstanceRuntime() === "deno") {
      parts.push("W worker");
    } else {
      parts.push("D deno");
    }
  }
  return ` · ${parts.join(" · ")}`;
}

export function statusHints(
  activeAreaId: string,
  selectedServiceId?: string | null,
  installFinished?: boolean,
  pendingRestart?: PendingRestart | null,
  restartInProgress?: string | null,
): string {
  if (activeAreaId === "services") {
    if (pendingRestart) {
      return "↑ ↓ Yes/No · Enter select · Esc cancel · Ctrl-C exit";
    }
    if (restartInProgress) {
      return `Restarting ${restartInProgress} · watch logs · Ctrl-C exit`;
    }
    const actionHints = serviceActionHints(selectedServiceId);
    return `← → tabs · ↑↓ select · Tab log · ↑↓ scroll${actionHints} · Ctrl-C exit`;
  }
  if (activeAreaId === "developer") {
    return "↑ ↓ choose action · Enter run · ← → switch tabs · Ctrl-C exit";
  }
  if (activeAreaId === "bootstrap") {
    return installFinished
      ? "Finishing install · Ctrl-C exit"
      : "Installing development environment · Ctrl-C exit";
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
