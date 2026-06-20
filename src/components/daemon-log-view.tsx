import React from "react";
import { Box, Text } from "ink";
import { ScrollList } from "ink-scroll-list";
import { daemonLogLineKey } from "../lib/log-lines-equal.ts";
import {
  type DaemonLogLevel,
  type DaemonLogLine,
  formatLogDisplayTime,
} from "../lib/daemon-log.ts";
import {
  LOG_COMPONENT,
  LOG_ERROR,
  LOG_TIME,
  LOG_WARN,
} from "../theme.ts";

function truncateText(text: string, maxWidth: number): string {
  if (maxWidth < 4) {
    return "…";
  }
  if (text.length <= maxWidth) {
    return text;
  }
  return `${text.slice(0, maxWidth - 1)}…`;
}

function levelColor(level: DaemonLogLevel): string | undefined {
  switch (level) {
    case "debug":
      return LOG_TIME;
    case "warn":
      return LOG_WARN;
    case "error":
      return LOG_ERROR;
    default:
      return undefined;
  }
}

const LOG_TIME_WIDTH = 8;

function structuredPrefixWidth(line: DaemonLogLine): number {
  return LOG_TIME_WIDTH + 1 + 6 + 1 + 16 + 1;
}

function LogRow({
  line,
  width,
}: {
  line: DaemonLogLine;
  width: number;
}) {
  const time = formatLogDisplayTime(line.time).padEnd(LOG_TIME_WIDTH);
  const level = line.level.toUpperCase().padEnd(5);
  const component = line.component.padEnd(16);
  const maxMessageWidth = Math.max(1, width - structuredPrefixWidth(line));
  const message = truncateText(line.message, maxMessageWidth);
  const err = line.err ? truncateText(line.err, maxMessageWidth) : undefined;

  return (
    <Text wrap="truncate">
      <Text color={LOG_TIME}>{time} </Text>
      <Text color={levelColor(line.level)}>{level} </Text>
      <Text color={LOG_COMPONENT}>{component} </Text>
      <Text>{message}</Text>
      {err && (
        <Text color={LOG_WARN}> ({err})</Text>
      )}
    </Text>
  );
}

export function DaemonLogView({
  lines,
  width,
  height,
  selectedIndex,
}: {
  lines: DaemonLogLine[];
  width: number;
  height: number;
  selectedIndex: number;
  focused?: boolean;
}) {
  const scrollIndex = lines.length === 0
    ? 0
    : Math.min(selectedIndex, lines.length - 1);

  return (
    <Box
      width={width}
      height={height}
      flexDirection="column"
      minHeight={0}
    >
      <ScrollList height={height} selectedIndex={scrollIndex} scrollAlignment="bottom">
        {lines.map((line, index) => (
          <LogRow
            key={daemonLogLineKey(line, index)}
            line={line}
            width={width}
          />
        ))}
      </ScrollList>
    </Box>
  );
}
