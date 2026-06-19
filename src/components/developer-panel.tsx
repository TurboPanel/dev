import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { DevServiceStatus } from "../dev-services.ts";
import {
  DAEMON_ACTION_LABELS,
  developerMenuActions,
  type DaemonActionId,
} from "../lib/daemon-actions.ts";
import type { DaemonOperation } from "../lib/spinners.ts";
import { LIST_SELECT_BG, LIST_SELECT_FG } from "../theme.ts";
import { PurgeDaemonPanel } from "./purge-daemon-panel.tsx";

export function DeveloperPanel({
  width,
  height,
  daemonStatus,
  daemonOperation,
  onDaemonAction,
  onPurgeDone,
}: {
  width: number;
  height: number;
  daemonStatus?: DevServiceStatus;
  daemonOperation?: DaemonOperation | null;
  onDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  onPurgeDone?: () => void;
}) {
  if (daemonOperation === "purge" && onPurgeDone) {
    return (
      <PurgeDaemonPanel
        width={width}
        height={height}
        onDone={onPurgeDone}
      />
    );
  }

  const actions = developerMenuActions(daemonStatus);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setSelectedIndex(0);
    setMessage(null);
  }, [daemonStatus]);

  useEffect(() => {
    if (selectedIndex >= actions.length) {
      setSelectedIndex(Math.max(0, actions.length - 1));
    }
  }, [actions.length, selectedIndex]);

  useInput((_input, key) => {
    if (actions.length === 0 || !onDaemonAction) {
      return;
    }

    const lastIndex = actions.length - 1;
    if (key.upArrow) {
      setSelectedIndex((index) => Math.max(0, index - 1));
      setMessage(null);
    }
    if (key.downArrow) {
      setSelectedIndex((index) => Math.min(lastIndex, index + 1));
      setMessage(null);
    }
    if (key.return) {
      const action = actions[selectedIndex];
      if (action) {
        void Promise.resolve(onDaemonAction(action)).catch((error: unknown) => {
          const text = error instanceof Error ? error.message : String(error);
          setMessage(text);
        });
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      paddingX={1}
      paddingY={1}
    >
      <Text bold>Developer</Text>
      <Box marginTop={1}>
        <Text dimColor>TurboPanel development console</Text>
      </Box>

      {actions.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          {actions.map((action, index) => {
            const selected = index === selectedIndex;
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
      )}

      {message && (
        <Box marginTop={1}>
          <Text color="red">{message}</Text>
        </Box>
      )}
    </Box>
  );
}
