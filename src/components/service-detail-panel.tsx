import React, { useMemo } from "react";
import { Box, useInput } from "ink";
import type { DevService } from "../dev-services.ts";
import type { ConsoleLogLine } from "../lib/service-restart.ts";
import { useLogScroll } from "../hooks/use-log-scroll.ts";
import { useServiceLog } from "../hooks/use-service-log.ts";
import { InstanceTitleHeader, instanceTitleHeaderRows } from "./instance-title-header.tsx";
import { PlainLogView } from "./plain-log-view.tsx";
import { measureTitleArtRows, ServiceTitle } from "./service-title.tsx";

export function ServiceDetailPanel({
  service,
  width,
  height,
  focused = false,
  logOverlayLines = [],
  logFollowResetKey,
}: {
  service: DevService;
  width: number;
  height: number;
  focused?: boolean;
  logOverlayLines?: ConsoleLogLine[];
  logFollowResetKey?: number;
}) {
  const fileLogLines = useServiceLog(service.id);
  const logLines = useMemo(
    () => [
      ...fileLogLines,
      ...logOverlayLines.map((line) => ({ text: line.text, time: line.time })),
    ],
    [fileLogLines, logOverlayLines],
  );
  const innerWidth = Math.max(1, width - 2);
  const isInstance = service.id === "instance";
  const titleRows = isInstance
    ? instanceTitleHeaderRows(service.label, innerWidth)
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
  }, { isActive: focused });

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      paddingX={1}
      paddingTop={0}
    >
      {isInstance ? (
        <InstanceTitleHeader label={service.label} width={innerWidth} />
      ) : (
        <ServiceTitle
          serviceId={service.id}
          label={service.label}
          width={innerWidth}
        />
      )}

      <Box flexGrow={1} minHeight={0} height={logHeight}>
        <PlainLogView
          lines={logLines}
          width={innerWidth}
          height={logHeight}
          selectedIndex={logScrollIndex}
          focused={focused}
        />
      </Box>
    </Box>
  );
}
