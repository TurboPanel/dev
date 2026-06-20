import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box } from "ink";
import {
  ScrollList,
  type ScrollAlignment,
  type ScrollListRef,
} from "ink-scroll-list";
import { LogScrollbar } from "./log-scrollbar.tsx";

type LogScrollMetrics = {
  scrollOffset: number;
  contentHeight: number;
  viewportHeight: number;
};

function emptyMetrics(viewportHeight: number): LogScrollMetrics {
  return {
    scrollOffset: 0,
    contentHeight: 0,
    viewportHeight,
  };
}

function resolveLogScrollOffset(
  ref: ScrollListRef,
  selectedIndex: number,
  scrollAlignment: ScrollAlignment,
): number {
  const contentHeight = ref.getContentHeight();
  const viewportHeight = ref.getViewportHeight();
  const maxScroll = Math.max(0, contentHeight - viewportHeight);

  if (scrollAlignment === "bottom" && selectedIndex >= 0) {
    const position = ref.getItemPosition(selectedIndex);
    if (position) {
      return Math.max(
        0,
        Math.min(position.top + position.height - viewportHeight, maxScroll),
      );
    }
  }

  return Math.min(ref.getScrollOffset(), maxScroll);
}

export function ScrollableLogList({
  height,
  width,
  selectedIndex,
  scrollAlignment = "bottom",
  focused = false,
  children,
}: {
  height: number;
  width: number;
  selectedIndex: number;
  scrollAlignment?: ScrollAlignment;
  focused?: boolean;
  children: React.ReactNode;
}) {
  const listRef = useRef<ScrollListRef>(null);
  const [metrics, setMetrics] = useState(() => emptyMetrics(height));
  const listWidth = focused ? Math.max(1, width - 1) : width;

  const syncMetrics = useCallback(() => {
    const ref = listRef.current;
    if (!ref) {
      return;
    }

    setMetrics({
      scrollOffset: resolveLogScrollOffset(ref, selectedIndex, scrollAlignment),
      contentHeight: ref.getContentHeight(),
      viewportHeight: ref.getViewportHeight(),
    });
  }, [scrollAlignment, selectedIndex]);

  useEffect(() => {
    syncMetrics();
  }, [selectedIndex, height, children, focused, syncMetrics]);

  return (
    <Box flexDirection="row" width={width} height={height} minHeight={0}>
      <Box width={listWidth} height={height} minHeight={0}>
        <ScrollList
          ref={listRef}
          height={height}
          selectedIndex={selectedIndex}
          scrollAlignment={scrollAlignment}
          onScroll={syncMetrics}
          onContentHeightChange={syncMetrics}
          onViewportSizeChange={syncMetrics}
        >
          {children}
        </ScrollList>
      </Box>
      {focused ? (
        <LogScrollbar
          height={height}
          contentHeight={metrics.contentHeight}
          viewportHeight={metrics.viewportHeight}
          scrollOffset={metrics.scrollOffset}
          focused
        />
      ) : null}
    </Box>
  );
}
