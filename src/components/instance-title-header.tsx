import React from "react";
import { Box } from "ink";
import { InstanceRuntimeBadge } from "./instance-runtime-badge.tsx";
import { measureTitleArtRows, ServiceTitle } from "./service-title.tsx";

const RUNTIME_BADGE_RESERVE = 12;

function titleWidthForBadge(width: number): number {
  return Math.max(1, width - RUNTIME_BADGE_RESERVE);
}

export function instanceTitleHeaderRows(label: string, width: number): number {
  return measureTitleArtRows(label, titleWidthForBadge(width));
}

export function InstanceTitleHeader({
  label,
  width,
}: {
  label: string;
  width: number;
}) {
  const titleWidth = titleWidthForBadge(width);

  return (
    <Box flexDirection="row" width={width} alignItems="flex-end">
      <Box flexGrow={1}>
        <ServiceTitle serviceId="instance" label={label} width={titleWidth} />
      </Box>
      <InstanceRuntimeBadge />
    </Box>
  );
}
