import React from "react";
import { Box } from "ink";
import { InstanceRuntimeBadge } from "./instance-runtime-badge.tsx";
import { serviceBrowserUrl } from "../lib/service-urls.ts";
import { INSTANCE_BADGE_RESERVE, type StackBadgeRuntime } from "../lib/stack-versions.ts";
import { ServiceBrowserLink } from "./service-browser-link.tsx";
import { measureTitleArtRows, ServiceTitle } from "./service-title.tsx";

const DEFAULT_BADGE_RESERVE = INSTANCE_BADGE_RESERVE;

function titleWidthForBadge(width: number, badgeReserve: number): number {
  return Math.max(1, width - badgeReserve);
}

function metaColumnRows(serviceId?: string): number {
  if (serviceId && serviceBrowserUrl(serviceId)) {
    return 2;
  }
  return 1;
}

export function runtimeTitleHeaderRows(
  label: string,
  width: number,
  badgeReserve = DEFAULT_BADGE_RESERVE,
  serviceId?: string,
): number {
  const artRows = measureTitleArtRows(label, titleWidthForBadge(width, badgeReserve));
  return Math.max(artRows, metaColumnRows(serviceId));
}

export function instanceTitleHeaderRows(label: string, width: number): number {
  return runtimeTitleHeaderRows(label, width);
}

export function RuntimeTitleHeader({
  serviceId,
  label,
  width,
  runtime,
  badgeReserve = DEFAULT_BADGE_RESERVE,
}: {
  serviceId: string;
  label: string;
  width: number;
  runtime?: StackBadgeRuntime;
  badgeReserve?: number;
}) {
  const titleWidth = titleWidthForBadge(width, badgeReserve);

  return (
    <Box flexDirection="row" width={width} alignItems="flex-end">
      <ServiceTitle
        serviceId={serviceId}
        label={label}
        width={titleWidth}
        shrinkWrap
      />
      <Box marginLeft={1} marginBottom={1} flexDirection="column">
        <ServiceBrowserLink serviceId={serviceId} />
        <InstanceRuntimeBadge runtime={runtime} serviceId={serviceId} />
      </Box>
    </Box>
  );
}

export function InstanceTitleHeader({
  label,
  width,
}: {
  label: string;
  width: number;
}) {
  return (
    <RuntimeTitleHeader serviceId="instance" label={label} width={width} />
  );
}
