import React from "react";
import { Text } from "@deno-ink/core";
import { AreaTabs } from "@turbopanel/components/area-tabs.tsx";
import { RuntimeBadge } from "@turbopanel/components/runtime-badge.tsx";

export type ConsoleArea = { id: string; label: string };

export function MenuBar({
  areas,
  activeIndex,
  instanceRuntime,
}: {
  areas: ConsoleArea[];
  activeIndex: number;
  instanceRuntime: "deno" | "workers";
}) {
  return (
    <Text wrap="truncate">
      <Text bold color="cyan">TurboPanel</Text>
      <Text dimColor> · </Text>
      <RuntimeBadge runtime={instanceRuntime} />
      <Text dimColor> · </Text>
      <AreaTabs areas={areas} activeIndex={activeIndex} />
    </Text>
  );
}
