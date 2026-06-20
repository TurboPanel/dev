import React from "react";
import { Box, Text } from "ink";
import { ScrollList } from "ink-scroll-list";
import {
  formatLogDisplayTime,
  LOG_TIME_WIDTH,
} from "../lib/daemon-log.ts";
import type { ServiceLogLine } from "../lib/service-log.ts";
import { LOG_TIME } from "../theme.ts";

function truncateText(text: string, maxWidth: number): string {
  if (maxWidth < 4) {
    return "…";
  }
  if (text.length <= maxWidth) {
    return text;
  }
  return `${text.slice(0, maxWidth - 1)}…`;
}

export function PlainLogView({
  lines,
  width,
  height,
  selectedIndex,
  focused,
}: {
  lines: ServiceLogLine[];
  width: number;
  height: number;
  selectedIndex: number;
  focused: boolean;
}) {
  const scrollIndex = lines.length === 0
    ? 0
    : Math.min(selectedIndex, lines.length - 1);

  return (
    <Box
      width={width}
      height={height}
      flexDirection="column"
      flexGrow={1}
      minHeight={0}
    >
      <ScrollList height={height} selectedIndex={scrollIndex}>
        {lines.map((line, index) => {
          const dim = index !== scrollIndex;
          const bold = focused && index === scrollIndex;
          const showTime = line.time != null && line.time.length > 0;
          const maxMessageWidth = showTime
            ? Math.max(1, width - LOG_TIME_WIDTH - 1)
            : Math.max(1, width);
          const message = truncateText(line.text, maxMessageWidth);

          return (
            <Text
              key={`${index}:${line.text.slice(0, 24)}`}
              bold={bold}
              wrap="truncate"
            >
              {showTime ? (
                <>
                  <Text color={LOG_TIME} dimColor={dim}>
                    {formatLogDisplayTime(line.time!).padEnd(LOG_TIME_WIDTH)}{" "}
                  </Text>
                  <Text dimColor={dim}>{message}</Text>
                </>
              ) : (
                <Text dimColor={dim}>{message}</Text>
              )}
            </Text>
          );
        })}
      </ScrollList>
    </Box>
  );
}
