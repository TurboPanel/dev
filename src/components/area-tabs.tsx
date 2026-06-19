import React from "react";
import { Text } from "ink";

export type AreaTab = { id: string; label: string };

export function AreaTabs({
  areas,
  activeIndex,
}: {
  areas: AreaTab[];
  activeIndex: number;
}) {
  return (
    <Text wrap="truncate">
      {areas.map((area, index) => {
        const active = index === activeIndex;
        return (
          <Text key={area.id}>
            {index > 0 ? <Text dimColor> · </Text> : null}
            <Text
              bold={active}
              color={active ? "cyan" : undefined}
              dimColor={!active}
            >
              {area.label}
            </Text>
          </Text>
        );
      })}
    </Text>
  );
}
