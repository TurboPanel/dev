import React from "react";
import { Box } from "ink";
import { InstanceRuntimeBadge } from "./instance-runtime-badge.tsx";
import { measureTitleArtRows, ServiceTitle } from "./service-title.tsx";

export function instanceTitleHeaderRows(label: string, width: number): number {
  return measureTitleArtRows(label, width) + 1;
}

export function InstanceTitleHeader({
  label,
  width,
}: {
  label: string;
  width: number;
}) {
  return (
    <Box flexDirection="column" width={width}>
      <ServiceTitle serviceId="instance" label={label} width={width} />
      <Box width={width} flexDirection="row" justifyContent="flex-end">
        <InstanceRuntimeBadge />
      </Box>
    </Box>
  );
}
