import React, { memo, useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, type Key } from "ink";
import type { DevService } from "../dev-services.ts";
import {
  DAEMON_ACTION_LABELS,
  type DaemonActionId,
} from "../lib/daemon-actions.ts";
import type { DaemonLogByteFloor, DaemonLogLine } from "../lib/daemon-log.ts";
import {
  parseDaemonLogLine,
  shouldHideDaemonLogLine,
} from "../lib/daemon-log.ts";
import type { ConsoleLogLine } from "../lib/service-restart.ts";
import { useLogScroll } from "../hooks/use-log-scroll.ts";
import { useDaemonLog } from "../hooks/use-daemon-log.ts";
import { LIST_SELECT_BG, LIST_SELECT_FG } from "../theme.ts";
import { DaemonLogView } from "./daemon-log-view.tsx";
import { LogLoadingPlaceholder } from "./log-loading-placeholder.tsx";
import { RuntimeTitleHeader, runtimeTitleHeaderRows } from "./instance-title-header.tsx";

type DetailFocus = "actions" | "log";

function handleDaemonDetailKey(
  key: Key,
  options: {
    focusTargets: DetailFocus[];
    focus: DetailFocus;
    setFocus: (focus: DetailFocus) => void;
    logFocused: boolean;
    handleLogKey: (key: Key) => void;
    logInputActive: boolean;
    actions: DaemonActionId[];
    selectedActionIndex: number;
    setSelectedActionIndex: React.Dispatch<React.SetStateAction<number>>;
    onDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
    setActionMessage: (message: string | null) => void;
  },
): void {
  if (key.tab) {
    const currentIndex = options.focusTargets.indexOf(options.focus);
    const next = options.focusTargets[(currentIndex + 1) % options.focusTargets.length];
    if (next) {
      options.setFocus(next);
    }
    return;
  }

  if (options.logFocused) {
    options.handleLogKey(key);
    return;
  }

  if (options.focus !== "actions" || !options.logInputActive) {
    return;
  }

  const lastAction = options.actions.length - 1;
  if (key.upArrow) {
    options.setSelectedActionIndex((index) => Math.max(0, index - 1));
  }
  if (key.downArrow) {
    options.setSelectedActionIndex((index) => Math.min(lastAction, index + 1));
  }
  if (key.return && options.actions.length > 0 && options.onDaemonAction) {
    const action = options.actions[options.selectedActionIndex];
    if (action) {
      void Promise.resolve(options.onDaemonAction(action)).catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        options.setActionMessage(text);
      });
    }
  }
}

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
    if (entry && !shouldHideDaemonLogLine(entry)) {
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
  daemonLogByteFloor = null,
}: {
  service: DevService;
  actions: DaemonActionId[];
  width: number;
  height: number;
  onDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  logInputActive?: boolean;
  logOverlayLines?: ConsoleLogLine[];
  logFollowResetKey?: number;
  daemonLogByteFloor?: DaemonLogByteFloor | null;
}) {
  const { lines: fileLogLines, loading: logLoading } = useDaemonLog(
    daemonLogByteFloor,
    logFollowResetKey,
  );
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
    handleDaemonDetailKey(key, {
      focusTargets,
      focus,
      setFocus,
      logFocused,
      handleLogKey,
      logInputActive,
      actions,
      selectedActionIndex,
      setSelectedActionIndex,
      onDaemonAction,
      setActionMessage,
    });
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
        {logLoading ? (
          <LogLoadingPlaceholder width={innerWidth} height={logHeight} />
        ) : (
          <DaemonLogView
            lines={logLines}
            width={innerWidth}
            height={logHeight}
            selectedIndex={logScrollIndex}
            focused={logFocused}
          />
        )}
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
