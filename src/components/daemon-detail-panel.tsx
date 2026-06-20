import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { DevService } from "../dev-services.ts";
import type { DaemonLogLevel } from "../lib/daemon-log.ts";
import {
  DAEMON_ACTION_LABELS,
  type DaemonActionId,
} from "../lib/daemon-actions.ts";
import { useDaemonLog } from "../hooks/use-daemon-log.ts";
import { LIST_SELECT_BG, LIST_SELECT_FG } from "../theme.ts";
import { DaemonLogView } from "./daemon-log-view.tsx";
import { measureTitleArtRows, ServiceTitle } from "./service-title.tsx";

type DetailFocus = "actions" | "log";
type LogLevelFilter = "all" | DaemonLogLevel;
const LOG_LEVEL_FILTERS: LogLevelFilter[] = ["all", "debug", "info", "warn", "error"];

export function DaemonDetailPanel({
  service,
  actions,
  width,
  height,
  onDaemonAction,
  suspended = false,
  logInputActive = false,
}: {
  service: DevService;
  actions: DaemonActionId[];
  width: number;
  height: number;
  onDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  suspended?: boolean;
  logInputActive?: boolean;
}) {
  const logLines = useDaemonLog();
  const focusTargets = useMemo((): DetailFocus[] => {
    const targets: DetailFocus[] = ["log"];
    if (actions.length > 0) {
      targets.push("actions");
    }
    return targets;
  }, [actions.length]);

  const [focus, setFocus] = useState<DetailFocus>(focusTargets[0] ?? "log");
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [logScrollIndex, setLogScrollIndex] = useState(0);
  const [logLevelFilter, setLogLevelFilter] = useState<LogLevelFilter>("all");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const filteredLogLines = useMemo(() => {
    if (logLevelFilter === "all") {
      return logLines;
    }
    return logLines.filter((line) => line.level === logLevelFilter);
  }, [logLines, logLevelFilter]);

  useEffect(() => {
    if (!focusTargets.includes(focus)) {
      setFocus(focusTargets[0] ?? "log");
    }
  }, [focus, focusTargets]);

  useEffect(() => {
    setSelectedActionIndex(0);
  }, [actions.length]);

  useEffect(() => {
    setLogScrollIndex(Math.max(0, filteredLogLines.length - 1));
  }, [filteredLogLines]);

  const innerWidth = Math.max(1, width - 2);
  const titleRows = measureTitleArtRows(service.label, innerWidth);
  const staticHeaderRows = titleRows + 3;
  const actionsRows = actions.length > 0 ? actions.length + 1 : 0;
  const logHeight = Math.max(3, height - staticHeaderRows - actionsRows - 2);

  useInput((_input, key) => {
    if (suspended) {
      return;
    }
    if (_input === "l" || _input === "L") {
      setLogLevelFilter((current) => {
        const idx = LOG_LEVEL_FILTERS.indexOf(current);
        const next = LOG_LEVEL_FILTERS[(idx + 1) % LOG_LEVEL_FILTERS.length];
        return next;
      });
      return;
    }

    if (key.tab) {
      const currentIndex = focusTargets.indexOf(focus);
      const next = focusTargets[(currentIndex + 1) % focusTargets.length];
      if (next) {
        setFocus(next);
      }
      return;
    }

    if (focus === "log" && logInputActive) {
      const lastIndex = Math.max(0, filteredLogLines.length - 1);
      if (key.upArrow) {
        setLogScrollIndex((index) => Math.max(0, index - 1));
      }
      if (key.downArrow) {
        setLogScrollIndex((index) => Math.min(lastIndex, index + 1));
      }
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
      paddingBottom={1}
    >
      <ServiceTitle
        serviceId={service.id}
        label={service.label}
        width={innerWidth}
      />

      <Box marginTop={1}>
        <Text dimColor>
          Log level: {logLevelFilter.toUpperCase()} (L to change)
        </Text>
      </Box>

      <Box marginTop={1} flexGrow={1} minHeight={0}>
        <DaemonLogView
          lines={filteredLogLines}
          width={innerWidth}
          height={logHeight}
          selectedIndex={logScrollIndex}
          focused={focus === "log" && logInputActive}
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
}
