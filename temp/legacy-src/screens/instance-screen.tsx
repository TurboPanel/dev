import React from "react";
import { Box } from "ink";
import { InstanceSection } from "@turbopanel/sections/instance-section.tsx";

export function InstanceScreen({
  onSwitch,
}: {
  onSwitch: (target: "deno" | "workers") => void;
}) {
  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
      <InstanceSection onSwitch={onSwitch} />
    </Box>
  );
}
