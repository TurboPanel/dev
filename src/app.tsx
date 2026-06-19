import React from "react";
import { Box, Text } from "ink";
import { MainPanel } from "@turbopanel/components/main-panel.tsx";
import { MenuBar, type AreaTab } from "@turbopanel/components/menu-bar.tsx";
import { StatusBar } from "@turbopanel/components/status-bar.tsx";

export const AREAS: AreaTab[] = [
  { id: "status", label: "Status" },
  { id: "instance", label: "Instance" },
  { id: "developer", label: "Developer" },
];

export function AppView({
  activeIndex,
  columns,
  rows,
}: {
  activeIndex: number;
  columns: number;
  rows: number;
}) {
  const activeArea = AREAS[activeIndex] ?? AREAS[0]!;
  const innerWidth = columns - 2;

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box flexShrink={0} height={1} paddingX={1}>
        <MenuBar areas={AREAS} activeIndex={activeIndex} columns={innerWidth} />
      </Box>

      <MainPanel width={columns}>
        <Text>{activeArea.label}</Text>
      </MainPanel>

      <Box flexShrink={0} height={1} paddingX={1}>
        <StatusBar columns={innerWidth} />
      </Box>
    </Box>
  );
}
