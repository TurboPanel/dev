import { Box, Text } from "ink";
import { AreaTabs } from "@turbopanel/components/area-tabs.tsx";
import { RuntimeBadge } from "@turbopanel/components/runtime-badge.tsx";

export type ConsoleArea = { id: string; label: string };

export function MenuBar({
  areas,
  activeIndex,
  instanceRuntime,
  columns,
}: {
  areas: ConsoleArea[];
  activeIndex: number;
  instanceRuntime: "deno" | "workers";
  columns: number;
}) {
  return (
    <Box flexDirection="row" width={columns} alignItems="center">
      <Text bold>TurboPanel</Text>
      <Box marginLeft={1}>
        <RuntimeBadge runtime={instanceRuntime} />
      </Box>
      <Box flexGrow={1} />
      <AreaTabs areas={areas} activeIndex={activeIndex} />
    </Box>
  );
}
