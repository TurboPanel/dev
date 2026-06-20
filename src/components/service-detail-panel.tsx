import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { DevService } from "../dev-services.ts";
import { useServiceLog } from "../hooks/use-service-log.ts";
import { serviceSystemdUnit } from "../lib/service-log.ts";
import { PlainLogView } from "./plain-log-view.tsx";

function statusLabel(status: DevService["status"]): string {
  switch (status) {
    case "running":
      return "running";
    case "starting":
      return "starting";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
    case "pending":
      return "needs setup";
    case "uninstalled":
      return "not installed";
  }
}

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
  const headerRows = 2;
  const logHeight = Math.max(3, height - headerRows);
  const unit = serviceSystemdUnit(service.id);

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
      <Text bold>{service.label}</Text>
      <Text dimColor>
        Status: {statusLabel(service.status)}
        {unit ? ` · ${unit}` : ""}
      </Text>

      <Box marginTop={1} flexGrow={1} minHeight={0}>
        <PlainLogView
          lines={logLines.map((line) => line.text)}
          width={innerWidth}
          height={logHeight}
          selectedIndex={logScrollIndex}
          focused={focused}
        />
      </Box>
    </Box>
  );
}
