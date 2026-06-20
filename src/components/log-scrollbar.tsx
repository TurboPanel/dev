import React from "react";
import { Box, Text } from "ink";
import { BORDER_COLOR, LIST_FOCUS_FG } from "../theme.ts";

const TRACK_CHAR = "▕";
const THUMB_CHAR = "█";

export function logContentWidth(width: number, focused = false): number {
  return focused ? Math.max(1, width - 1) : width;
}

export function computeLogScrollbarThumb({
  trackHeight,
  contentHeight,
  viewportHeight,
  scrollOffset,
}: {
  trackHeight: number;
  contentHeight: number;
  viewportHeight: number;
  scrollOffset: number;
}): { thumbTop: number; thumbSize: number; scrollable: number } {
  const scrollable = Math.max(0, contentHeight - viewportHeight);
  if (scrollable <= 0 || trackHeight <= 0) {
    return { thumbTop: 0, thumbSize: 0, scrollable: 0 };
  }

  const thumbSize = Math.max(
    1,
    Math.min(trackHeight, Math.round((viewportHeight / contentHeight) * trackHeight)),
  );
  const maxThumbTop = Math.max(0, trackHeight - thumbSize);
  const thumbTop = Math.round((scrollOffset / scrollable) * maxThumbTop);

  return { thumbTop, thumbSize, scrollable };
}

export function LogScrollbar({
  height,
  contentHeight,
  viewportHeight,
  scrollOffset,
  focused = false,
}: {
  height: number;
  contentHeight: number;
  viewportHeight: number;
  scrollOffset: number;
  focused?: boolean;
}) {
  const { thumbTop, thumbSize, scrollable } = computeLogScrollbarThumb({
    trackHeight: height,
    contentHeight,
    viewportHeight,
    scrollOffset,
  });
  const thumbColor = focused ? LIST_FOCUS_FG : undefined;
  const trackColor = BORDER_COLOR;

  return (
    <Box flexDirection="column" width={1} height={height}>
      {Array.from({ length: height }, (_, row) => {
        const inThumb = scrollable > 0 && row >= thumbTop && row < thumbTop + thumbSize;
        return (
          <Text key={row} color={inThumb ? thumbColor : trackColor} dimColor={!inThumb}>
            {inThumb ? THUMB_CHAR : TRACK_CHAR}
          </Text>
        );
      })}
    </Box>
  );
}
