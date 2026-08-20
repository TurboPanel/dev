import React from "react";
import { Box } from "ink";
import { LogScrollbar } from "./log-scrollbar.tsx";

export function ScrollableLogList({
  height,
  width,
  selectedIndex,
  focused = false,
  totalItems,
  scrollOffset = 0,
  children,
}: Readonly<{
  height: number;
  width: number;
  selectedIndex: number;
  focused?: boolean;
  totalItems?: number;
  scrollOffset?: number;
  children: React.ReactNode;
}>) {
  const listWidth = focused ? Math.max(1, width - 1) : width;
  const childCount = React.Children.count(children);
  const contentHeight = totalItems ?? childCount;
  const viewportHeight = height;

  return (
    <Box flexDirection="row" width={width} height={height} minHeight={0}>
      <Box width={listWidth} height={height} minHeight={0} flexDirection="column">
        {children}
      </Box>
      {focused ? (
        <LogScrollbar
          height={height}
          contentHeight={contentHeight}
          viewportHeight={viewportHeight}
          scrollOffset={scrollOffset}
          focused
        />
      ) : null}
    </Box>
  );
}
