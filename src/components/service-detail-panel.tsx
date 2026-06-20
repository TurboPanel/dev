import React, { useEffect, useState } from "react";
import { Box, useInput } from "ink";
import type { DevService } from "../dev-services.ts";
import { useServiceLog } from "../hooks/use-service-log.ts";
import { PlainLogView } from "./plain-log-view.tsx";
import { InstanceRuntimeBadge, INSTANCE_RUNTIME_BADGE_WIDTH } from "./instance-runtime-badge.tsx";
import { measureTitleArtRows, ServiceTitle } from "./service-title.tsx";

export function ServiceDetailPanel({
  service,
  width,
  height,
  focused = false,
}: {
  service: DevService;
  width: number;
  height: number;
  focused?: boolean;
}) {
  const logLines = useServiceLog(service.id);
  const [logScrollIndex, setLogScrollIndex] = useState(0);
  const innerWidth = Math.max(1, width - 2);
  const isInstance = service.id === "instance";
  const titleWidth = isInstance
    ? Math.max(12, innerWidth - INSTANCE_RUNTIME_BADGE_WIDTH)
    : innerWidth;
  const titleRows = measureTitleArtRows(service.label, titleWidth);
  const staticHeaderRows = titleRows;
  const logHeight = Math.max(3, height - staticHeaderRows - 2);

  useEffect(() => {
    setLogScrollIndex(Math.max(0, logLines.length - 1));
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
      <Box flexDirection="row" width={innerWidth} alignItems="flex-start">
        <ServiceTitle
          serviceId={service.id}
          label={service.label}
          width={titleWidth}
        />
        {isInstance ? (
          <Box marginLeft={1}>
            <InstanceRuntimeBadge />
          </Box>
        ) : null}
      </Box>

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
