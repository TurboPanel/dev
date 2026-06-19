import React from "react";
import { Box, Text } from "ink";
import { MainPanel } from "@turbopanel/components/main-panel.tsx";
import { MenuBar, type AreaTab } from "@turbopanel/components/menu-bar.tsx";
import { StatusBar } from "@turbopanel/components/status-bar.tsx";
import { DARK_GREY } from "./theme.ts";

export const AREAS: AreaTab[] = [
  { id: "dashboard", label: "Dashboard", emoji: "📊" },
  { id: "services", label: "Services", emoji: "⚙" },
  { id: "developer", label: "Developer", emoji: "💻" },
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

  return (
    <Box
      flexDirection="column"
      width={columns}
      height={rows}
      backgroundColor={DARK_GREY}
    >
      <MenuBar areas={AREAS} activeIndex={activeIndex} columns={columns} />

      <MainPanel width={columns}>
        <Text>{activeArea.label}</Text>
      </MainPanel>

      <StatusBar columns={columns} />
    </Box>
  );
}
