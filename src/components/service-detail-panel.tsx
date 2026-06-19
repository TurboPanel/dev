import React from "react";
import { Box, Text } from "ink";
import type { DevService } from "../dev-services.ts";
import {
  DAEMON_ACTION_LABELS,
  type DaemonActionId,
} from "../lib/daemon-actions.ts";
import { LIST_SELECT_BG, LIST_SELECT_FG } from "../theme.ts";

function statusLabel(status: DevService["status"]): string {
  switch (status) {
    case "running":
      return "running";
    case "starting":
      return "starting";
    case "stopped":
      return "stopped";
    case "pending":
      return "needs setup";
    case "uninstalled":
      return "not installed";
  }
}

export function ServiceDetailPanel({
  service,
  actions,
  selectedActionIndex,
  width,
  height,
  message,
}: {
  service: DevService;
  actions: DaemonActionId[];
  selectedActionIndex: number;
  width: number;
  height: number;
  message?: string | null;
}) {
  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      paddingX={1}
      paddingY={1}
    >
      <Text bold>{service.label}</Text>
      <Text dimColor>Status: {statusLabel(service.status)}</Text>

      <Box marginTop={1} flexDirection="column">
        {actions.map((action, index) => {
          const selected = index === selectedActionIndex;
          return (
            <Box
              key={action}
              width={Math.max(1, width - 2)}
              backgroundColor={selected ? LIST_SELECT_BG : undefined}
              flexDirection="row"
            >
              <Text color={selected ? LIST_SELECT_FG : undefined} bold={selected}>
                {DAEMON_ACTION_LABELS[action]}
              </Text>
            </Box>
          );
        })}
      </Box>

      {message && (
        <Box marginTop={1}>
          <Text color="red">{message}</Text>
        </Box>
      )}
    </Box>
  );
}
