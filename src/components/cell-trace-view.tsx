import React from "react";
import { Box, Text, useInput } from "ink";
import { useCellTraceLog } from "../hooks/use-cell-trace-log.ts";
import { useLogScroll } from "../hooks/use-log-scroll.ts";
import { PlainLogView } from "./plain-log-view.tsx";

const HEADER_ROWS = 2;

export function CellTraceView({
  width,
  height,
  focused,
  onClose,
}: Readonly<{
  width: number;
  height: number;
  focused: boolean;
  onClose: () => void;
}>) {
  const logLines = useCellTraceLog();
  const logHeight = Math.max(1, height - HEADER_ROWS);
  const { scrollIndex: logScrollIndex, handleLogKey } = useLogScroll({
    lineCount: logLines.length,
    viewportHeight: logHeight,
    focused,
    resetKey: "cell-trace",
  });

  useInput((_input, key) => {
    if (key.escape || key.leftArrow) {
      onClose();
      return;
    }
    handleLogKey(key);
  }, { isActive: focused });

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      paddingX={1}
      paddingY={1}
    >
      <Text bold>Cell Trace</Text>
      <Box marginTop={1} flexGrow={1}>
        <PlainLogView
          lines={logLines}
          width={width}
          height={logHeight}
          selectedIndex={logScrollIndex}
          focused={focused}
        />
      </Box>
    </Box>
  );
}
