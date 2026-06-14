import React from "react";
import { Box } from "@deno-ink/core";
import { InstanceSection } from "@turbopanel/sections/instance-section";

export function InstanceArea({
  onSwitch,
}: {
  onSwitch: (target: "deno" | "workers") => void;
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <InstanceSection onSwitch={onSwitch} />
    </Box>
  );
}
