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
    <Box flexDirection="row" marginTop={1}>
      <Text dimColor>← → </Text>
      {areas.map((area, index) => (
        <Box key={area.id} marginRight={2}>
          <Text
            bold={index === activeIndex}
            color={index === activeIndex ? "cyan" : undefined}
            dimColor={index !== activeIndex}
          >
            {index === activeIndex ? "› " : "  "}{area.label}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
