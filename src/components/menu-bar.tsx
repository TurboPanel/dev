import React from "react";
import { Box, Text } from "ink";
import { AreaTabs, type AreaTab } from "./area-tabs.tsx";

export type { AreaTab };

export function MenuBar({
  areas,
  activeIndex,
  columns,
}: {
  areas: AreaTab[];
  activeIndex: number;
  columns: number;
}) {
  return (
    <Box flexDirection="row" width={columns} height={1} alignItems="center">
      <Text bold>TurboPanel Developer Console</Text>
      <Box flexGrow={1} />
      <AreaTabs areas={areas} activeIndex={activeIndex} />
    </Box>
  );
}
