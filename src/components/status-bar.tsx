import React from "react";
import { Box, Text } from "ink";
import { BORDER_COLOR, DARK_GREY } from "../theme.ts";

export function statusHints(activeAreaId: string, openServiceId?: string | null): string {
  if (activeAreaId === "services") {
    return openServiceId
      ? "Esc back · ↑ ↓ choose action · Enter run · Ctrl-C exit"
      : "← → switch tabs · ↑ ↓ select service · Enter open · Ctrl-C exit";
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
      <Text color={BORDER_COLOR} backgroundColor={DARK_GREY}>
        ╰{"─".repeat(leftDashes)}
      </Text>
      <Box
        width={labelWidth}
        height={1}
        backgroundColor={DARK_GREY}
        justifyContent="center"
        paddingX={1}
      >
        <Text dimColor wrap="truncate">
          {display}
        </Text>
      </Box>
      <Text color={BORDER_COLOR} backgroundColor={DARK_GREY}>
        {"─".repeat(rightDashes)}╯
      </Text>
    </Box>
  );
}
