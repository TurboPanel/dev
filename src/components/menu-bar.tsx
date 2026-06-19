import React from "react";
import { Box, Text } from "ink";
import { ACTIVE_TAB_BG, BORDER_COLOR, MENU_BLUE, ON_MENU } from "../theme.ts";

export type AreaTab = { id: string; label: string; emoji: string };

const TITLE = "TurboPanel";
const PADDING_LEFT = 1;
const PADDING_RIGHT = 1;
const TAB_GAP = 2;
const TAB_PADDING = 1;

function tabWidth(area: AreaTab): number {
  return area.label.length + TAB_PADDING * 2;
}

function measureTabStrip(areas: AreaTab[], from: number, to: number): number {
  if (from >= to) {
    return 0;
  }

  let width = 0;
  for (let i = from; i < to; i++) {
    width += tabWidth(areas[i]!);
  }
  width += (to - from - 1) * TAB_GAP;
  return width;
}

function activeTabMetrics(
  areas: AreaTab[],
  activeIndex: number,
  columns: number,
) {
  const activeArea = areas[activeIndex] ?? areas[0]!;
  const activeWidth = tabWidth(activeArea);
  const stripWidth = measureTabStrip(areas, 0, areas.length);
  const stripStart = columns - PADDING_RIGHT - stripWidth;
  const tabOffset =
    activeIndex === 0 ? 0 : measureTabStrip(areas, 0, activeIndex) + TAB_GAP;
  const activeTabStart = stripStart + tabOffset;
  const rightWidth = columns - activeTabStart - activeWidth;

  return { activeArea, activeWidth, activeTabStart, rightWidth };
}

function TabSlot({
  area,
  active,
}: {
  area: AreaTab;
  active: boolean;
}) {
  return (
    <Box
      width={tabWidth(area)}
      height={1}
      justifyContent="center"
      alignItems="center"
      paddingX={active ? undefined : TAB_PADDING}
      backgroundColor={active ? ACTIVE_TAB_BG : undefined}
    >
      {active ? (
        <Text>{area.emoji}</Text>
      ) : (
        <Text color={ON_MENU} dimColor>
          {area.label}
        </Text>
      )}
    </Box>
  );
}

function TabStrip({
  areas,
  activeIndex,
}: {
  areas: AreaTab[];
  activeIndex: number;
}) {
  return (
    <Box flexDirection="row" alignItems="center">
      {areas.map((area, index) => (
        <React.Fragment key={area.id}>
          {index > 0 ? <Box width={TAB_GAP} /> : null}
          <TabSlot area={area} active={index === activeIndex} />
        </React.Fragment>
      ))}
      <Box width={PADDING_RIGHT} />
    </Box>
  );
}

export function MenuBar({
  areas,
  activeIndex,
  columns,
  provisioning,
  provisionerArea,
}: {
  areas: AreaTab[];
  activeIndex: number;
  columns: number;
  provisioning?: boolean;
  provisionerArea?: AreaTab;
}) {
  const displayAreas = provisioning && provisionerArea ? [provisionerArea] : areas;
  const displayActiveIndex = provisioning ? 0 : activeIndex;
  const { activeArea, activeWidth, activeTabStart, rightWidth } =
    activeTabMetrics(displayAreas, displayActiveIndex, columns);

  return (
    <Box flexDirection="column" width={columns}>
      <Box
        flexDirection="row"
        height={1}
        width={columns}
        alignItems="center"
        backgroundColor={MENU_BLUE}
      >
        <Box paddingLeft={PADDING_LEFT}>
          <Text bold color={ON_MENU}>
            {TITLE}
          </Text>
        </Box>
        <Box flexGrow={1} />
        <TabStrip areas={displayAreas} activeIndex={displayActiveIndex} />
      </Box>

      <Box flexDirection="row" width={columns} height={1}>
        <Box width={activeTabStart}>
          <Text color={BORDER_COLOR}>
            {"╭" + "─".repeat(Math.max(0, activeTabStart - 1))}
          </Text>
        </Box>
        <Box
          width={activeWidth}
          height={1}
          backgroundColor={ACTIVE_TAB_BG}
          justifyContent="center"
          alignItems="center"
        >
          <Text bold color={MENU_BLUE}>
            {activeArea.label}
          </Text>
        </Box>
        <Box width={rightWidth}>
          <Text color={BORDER_COLOR}>
            {rightWidth > 0
              ? "─".repeat(Math.max(0, rightWidth - 1)) + "╮"
              : "╮"}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
