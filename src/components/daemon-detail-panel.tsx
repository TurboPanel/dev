import React, { memo, useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { DevService } from "../dev-services.ts";
import {
  DAEMON_ACTION_LABELS,
  type DaemonActionId,
} from "../lib/daemon-actions.ts";
import { parseDaemonLogLine, shouldHideDaemonLogLine, type DaemonLogLine } from "../lib/daemon-log.ts";
import type { ConsoleLogLine } from "../lib/service-restart.ts";
import { useLogScroll } from "../hooks/use-log-scroll.ts";
import { useDaemonLog } from "../hooks/use-daemon-log.ts";
import { LIST_SELECT_BG, LIST_SELECT_FG } from "../theme.ts";
import { DaemonLogView } from "./daemon-log-view.tsx";
import { RuntimeTitleHeader, runtimeTitleHeaderRows } from "./instance-title-header.tsx";

type DetailFocus = "actions" | "log";

function overlayToDaemonLines(lines: ConsoleLogLine[]): DaemonLogLine[] {
  const parsed: DaemonLogLine[] = [];
  for (const line of lines) {
    if (line.text.startsWith("[console]")) {
      parsed.push({
        time: line.time,
        level: "info" as const,
        component: "console",
        message: line.text,
      });
      continue;
    }
    const entry = parseDaemonLogLine(line.text);
    if (!shouldHideDaemonLogLine(entry)) {
      parsed.push(entry);
    }
  }
  return parsed;
}

export const DaemonDetailPanel = memo(function DaemonDetailPanel({
  service,
  actions,
  width,
  height,
  onDaemonAction,
  logInputActive = false,
  logOverlayLines = [],
  logFollowResetKey,
}: {
  service: DevService;
  actions: DaemonActionId[];
  width: number;
  height: number;
  onDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  logInputActive?: boolean;
  logOverlayLines?: ConsoleLogLine[];
  logFollowResetKey?: number;
}) {
  const fileLogLines = useDaemonLog();
  const logLines = useMemo(
    () => [...fileLogLines, ...overlayToDaemonLines(logOverlayLines)],
    [fileLogLines, logOverlayLines],
  );
  const focusTargets = useMemo((): DetailFocus[] => {
    const targets: DetailFocus[] = ["log"];
    if (actions.length > 0) {
      targets.push("actions");
    }
    return targets;
  }, [actions.length]);

  const [focus, setFocus] = useState<DetailFocus>(focusTargets[0] ?? "log");
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!focusTargets.includes(focus)) {
      setFocus(focusTargets[0] ?? "log");
    }
  }, [focus, focusTargets]);

  useEffect(() => {
    setSelectedActionIndex(0);
  }, [actions.length]);

  const innerWidth = Math.max(1, width - 2);
  const titleRows = runtimeTitleHeaderRows(service.label, innerWidth, undefined, service.id);
  const staticHeaderRows = titleRows;
  const actionsRows = actions.length > 0 ? actions.length + 1 : 0;
  const logHeight = Math.max(1, height - staticHeaderRows - actionsRows);
  const logFocused = focus === "log" && logInputActive;
  const { scrollIndex: logScrollIndex, handleLogKey } = useLogScroll({
    lineCount: logLines.length,
    viewportHeight: logHeight,
    focused: logFocused,
    resetKey: service.id,
    followResetKey: logFollowResetKey,
  });

  useInput((_input, key) => {
    if (key.tab) {
      const currentIndex = focusTargets.indexOf(focus);
      const next = focusTargets[(currentIndex + 1) % focusTargets.length];
      if (next) {
        setFocus(next);
      }
      return;
    }

    if (logFocused) {
      handleLogKey(key);
      return;
    }

    if (focus === "actions" && logInputActive) {
      const lastAction = actions.length - 1;
      if (key.upArrow) {
        setSelectedActionIndex((index) => Math.max(0, index - 1));
      }
      if (key.downArrow) {
        setSelectedActionIndex((index) => Math.min(lastAction, index + 1));
      }
      if (key.return && actions.length > 0 && onDaemonAction) {
        const action = actions[selectedActionIndex];
        if (action) {
          void Promise.resolve(onDaemonAction(action)).catch((error: unknown) => {
            const text = error instanceof Error ? error.message : String(error);
            setActionMessage(text);
          });
        }
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      paddingX={1}
      paddingTop={0}
    >
      <RuntimeTitleHeader
        serviceId={service.id}
        label={service.label}
        width={innerWidth}
        runtime="deno"
      />

      <Box flexGrow={1} minHeight={0} height={logHeight}>
        <DaemonLogView
          lines={logLines}
          width={innerWidth}
          height={logHeight}
          selectedIndex={logScrollIndex}
          focused={logFocused}
        />
      </Box>

      {actions.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          {actions.map((action, index) => {
            const selected = focus === "actions" && index === selectedActionIndex;
            return (
              <Box
                key={action}
                width={innerWidth}
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

      {actionMessage && (
        <Box marginTop={1}>
          <Text color="red">{actionMessage}</Text>
        </Box>
      )}
    </Box>
  );
});
