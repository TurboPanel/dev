import React, { useEffect, useMemo, useState } from "react";
import { Box, useInput } from "ink";
import type { DevService } from "../dev-services.ts";
import { followLogScrollIndex } from "../lib/log-lines-equal.ts";
import type { ConsoleLogLine } from "../lib/service-restart.ts";
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
}: {
  service: DevService;
  width: number;
  height: number;
  focused?: boolean;
  logOverlayLines?: ConsoleLogLine[];
}) {
  const fileLogLines = useServiceLog(service.id);
  const logLines = useMemo(
    () => [
      ...fileLogLines,
      ...logOverlayLines.map((line) => ({ text: line.text, time: line.time })),
    ],
    [fileLogLines, logOverlayLines],
  );
  const [logScrollIndex, setLogScrollIndex] = useState(0);
  const innerWidth = Math.max(1, width - 2);
  const isInstance = service.id === "instance";
  const titleRows = isInstance
    ? instanceTitleHeaderRows(service.label, innerWidth)
    : measureTitleArtRows(service.label, innerWidth);
  const staticHeaderRows = titleRows;
  const logHeight = Math.max(3, height - staticHeaderRows - 2);

  useEffect(() => {
    setLogScrollIndex((index) => followLogScrollIndex(index, logLines.length));
  }, [logLines]);

  useInput((_input, key) => {
    const lastIndex = Math.max(0, logLines.length - 1);
    if (key.upArrow) {
      setLogScrollIndex((index) => Math.max(0, index - 1));
    }
    if (key.downArrow) {
      setLogScrollIndex((index) => Math.min(lastIndex, index + 1));
    }
  }, { isActive: focused });

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      paddingX={1}
      paddingTop={0}
      paddingBottom={1}
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

      <Box flexGrow={1} minHeight={0}>
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
