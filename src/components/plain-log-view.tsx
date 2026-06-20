import React from "react";
import { Box, Text } from "ink";
import { ScrollList } from "ink-scroll-list";
import {
  formatLogDisplayTime,
  LOG_TIME_WIDTH,
} from "../lib/daemon-log.ts";
import { serviceLogLineKey } from "../lib/log-lines-equal.ts";
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
}: {
  lines: ServiceLogLine[];
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
        {lines.map((line, index) => {
          const showTime = line.time != null && line.time.length > 0;
          const maxMessageWidth = showTime
            ? Math.max(1, width - LOG_TIME_WIDTH - 1)
            : Math.max(1, width);
          const message = truncateText(line.text, maxMessageWidth);

          return (
            <Text
              key={serviceLogLineKey(line, index)}
              wrap="truncate"
            >
              {showTime ? (
                <>
                  <Text color={LOG_TIME}>
                    {formatLogDisplayTime(line.time!).padEnd(LOG_TIME_WIDTH)}{" "}
                  </Text>
                  <Text>{message}</Text>
                </>
              ) : (
                <Text>{message}</Text>
              )}
            </Text>
          );
        })}
      </ScrollList>
    </Box>
  );
}
