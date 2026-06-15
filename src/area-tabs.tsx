import React from "react";
import { Box, Text } from "@deno-ink/core";

export type AreaTab = { id: string; label: string };

export function AreaTabs({
  areas,
  activeIndex,
}: {
  areas: AreaTab[];
  activeIndex: number;
}) {
  return (
    <Box flexDirection="row">
      {areas.map((area, index) => {
        const active = index === activeIndex;

        return (
          <Box
            key={area.id}
            marginLeft={index > 0 ? -1 : 0}
            borderStyle="single"
            borderColor={active ? "cyan" : undefined}
            borderDimColor={!active}
          >
            <Text bold={active} color={active ? "cyan" : undefined} dimColor={!active}>
              {" "}{area.label}{" "}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
