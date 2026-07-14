import React, { memo, useMemo } from "react";
import { Box, useInput } from "ink";
import type { DevService } from "../dev-services.ts";
import type { ConsoleLogLine } from "../lib/service-restart.ts";
import type { ServiceLogByteFloor } from "../lib/service-log.ts";
import { useLogScroll } from "../hooks/use-log-scroll.ts";
import { useServiceLog } from "../hooks/use-service-log.ts";
import { InstanceTitleHeader, RuntimeTitleHeader, runtimeTitleHeaderRows } from "./instance-title-header.tsx";
import { POSTGRES_BADGE_RESERVE } from "../lib/postgres-runtime.ts";
import {
  stackBadgeReserveForRuntime,
  type StackBadgeRuntime,
} from "../lib/stack-versions.ts";
import { LogLoadingPlaceholder } from "./log-loading-placeholder.tsx";
import { PlainLogView } from "./plain-log-view.tsx";
import { measureTitleArtRows, ServiceTitle } from "./service-title.tsx";

const PINNED_SERVICE_BADGES: Partial<
  Record<string, { runtime: StackBadgeRuntime; badgeReserve?: number }>
> = {
  web: {
    runtime: "caddy",
    badgeReserve: stackBadgeReserveForRuntime("caddy"),
  },
  dbstudio: {
    runtime: "node",
    badgeReserve: stackBadgeReserveForRuntime("node"),
  },
  ui: {
    runtime: "expo",
    badgeReserve: stackBadgeReserveForRuntime("expo"),
  },
  website: {
    runtime: "next",
    badgeReserve: stackBadgeReserveForRuntime("next", { serviceId: "website" }),
  },
  smtp: {
    runtime: "mailpit",
    badgeReserve: stackBadgeReserveForRuntime("mailpit"),
  },
  cache: {
    runtime: "redis",
    badgeReserve: stackBadgeReserveForRuntime("redis"),
  },
  redisinsight: {
    runtime: "redisinsight",
    badgeReserve: stackBadgeReserveForRuntime("redisinsight"),
  },
  queue: {
    runtime: "rabbitmq",
    badgeReserve: stackBadgeReserveForRuntime("rabbitmq"),
  },
  analytics: {
    runtime: "analytics",
    badgeReserve: stackBadgeReserveForRuntime("analytics"),
  },
  db: { runtime: "postgres", badgeReserve: POSTGRES_BADGE_RESERVE },
};

function ServiceDetailTitle({
  service,
  innerWidth,
  pinnedBadge,
}: Readonly<{
  service: DevService;
  innerWidth: number;
  pinnedBadge: { runtime: StackBadgeRuntime; badgeReserve?: number } | undefined;
}>) {
  if (service.id === "instance") {
    return <InstanceTitleHeader label={service.label} width={innerWidth} />;
  }

  if (pinnedBadge) {
    return (
      <RuntimeTitleHeader
        serviceId={service.id}
        label={service.label}
        width={innerWidth}
        runtime={pinnedBadge.runtime}
        badgeReserve={pinnedBadge.badgeReserve}
      />
    );
  }

  return (
    <ServiceTitle
      serviceId={service.id}
      label={service.label}
      width={innerWidth}
    />
  );
}

export const ServiceDetailPanel = memo(function ServiceDetailPanel({
  service,
  width,
  height,
  focused = false,
  logOverlayLines = [],
  logFollowResetKey,
  logByteFloor = null,
}: {
  service: DevService;
  width: number;
  height: number;
  focused?: boolean;
  logOverlayLines?: ConsoleLogLine[];
  logFollowResetKey?: number;
  logByteFloor?: ServiceLogByteFloor | null;
}) {
  const { lines: fileLogLines, loading: logLoading } = useServiceLog(
    service.id,
    logByteFloor,
  );
  const logLines = useMemo(
    () => [
      ...fileLogLines,
      ...logOverlayLines.map((line) => ({ text: line.text, time: line.time })),
    ],
    [fileLogLines, logOverlayLines],
  );
  const innerWidth = Math.max(1, width - 2);
  const isInstance = service.id === "instance";
  const pinnedBadge = PINNED_SERVICE_BADGES[service.id];
  const hasRuntimeBadge = isInstance || pinnedBadge !== undefined;
  const titleRows = hasRuntimeBadge
    ? runtimeTitleHeaderRows(
      service.label,
      innerWidth,
      pinnedBadge?.badgeReserve,
      service.id,
    )
    : measureTitleArtRows(service.label, innerWidth);
  const staticHeaderRows = titleRows;
  const logHeight = Math.max(1, height - staticHeaderRows);
  const { scrollIndex: logScrollIndex, handleLogKey } = useLogScroll({
    lineCount: logLines.length,
    viewportHeight: logHeight,
    focused,
    resetKey: service.id,
    followResetKey: logFollowResetKey,
  });

  useInput((_input, key) => {
    handleLogKey(key);
  }, { isActive: focused && !logLoading });

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      paddingX={1}
      paddingTop={0}
    >
      <ServiceDetailTitle
        service={service}
        innerWidth={innerWidth}
        pinnedBadge={pinnedBadge}
      />

      <Box flexGrow={1} minHeight={0} height={logHeight}>
        {logLoading ? (
          <LogLoadingPlaceholder width={innerWidth} height={logHeight} />
        ) : (
          <PlainLogView
            lines={logLines}
            width={innerWidth}
            height={logHeight}
            selectedIndex={logScrollIndex}
            focused={focused}
          />
        )}
      </Box>
    </Box>
  );
});
