import React, { memo } from "react";
import { Text } from "ink";
import {
  formatLogDisplayTime,
  LOG_TIME_WIDTH,
} from "../lib/daemon-log.ts";
import { serviceLogLineKey } from "../lib/log-lines-equal.ts";
import type { ServiceLogLine } from "../lib/service-log.ts";
import { LOG_TIME } from "../theme.ts";
import {
  logContentWidth,
  logContentWidthWithScrollbar,
} from "./log-scrollbar.tsx";
import { ScrollableLogList } from "./scrollable-log-list.tsx";

function truncateText(text: string, maxWidth: number): string {
  if (maxWidth < 4) {
    return "…";
  }
  if (text.length <= maxWidth) {
    return text;
  }
  return `${text.slice(0, maxWidth - 1)}…`;
}

function visibleWindowStart(
  lineCount: number,
  selectedIndex: number,
  viewportHeight: number,
): number {
  if (lineCount <= viewportHeight) {
    return 0;
  }
  const maxStart = Math.max(0, lineCount - viewportHeight);
  return Math.max(0, Math.min(selectedIndex - viewportHeight + 1, maxStart));
}

export const PlainLogView = memo(function PlainLogView({
  lines,
  width,
  height,
  selectedIndex,
  focused = false,
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
  const contentWidth = focused
    ? logContentWidthWithScrollbar(width)
    : logContentWidth(width);
  const windowStart = visibleWindowStart(lines.length, scrollIndex, height);
  const visibleLines = lines.slice(windowStart, windowStart + height);
  const visibleSelectedIndex = Math.max(0, scrollIndex - windowStart);

  return (
    <ScrollableLogList
      width={width}
      height={height}
      selectedIndex={visibleSelectedIndex}
      focused={focused}
      totalItems={lines.length}
      scrollOffset={windowStart}
    >
      {visibleLines.map((line, index) => {
        const absoluteIndex = windowStart + index;
        const showTime = line.time != null && line.time.length > 0;
        const maxMessageWidth = showTime
          ? Math.max(1, contentWidth - LOG_TIME_WIDTH - 1)
          : Math.max(1, contentWidth);
        const message = truncateText(line.text, maxMessageWidth);

        return (
          <Text
            key={serviceLogLineKey(line, absoluteIndex)}
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
    </ScrollableLogList>
  );
});
