import React, { type ReactNode } from "react";
import { Box } from "ink";
import { StatusBar } from "./status-bar.tsx";
import { BORDER_COLOR } from "../theme.ts";

export function MainPanel({
  width,
  status,
  children,
}: {
  width: number;
  status: string;
  children: ReactNode;
}) {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      minHeight={0}
      width={width}
    >
      <Box
        flexDirection="column"
        flexGrow={1}
        minHeight={0}
        borderStyle="round"
        borderColor={BORDER_COLOR}
        borderLeft
        borderRight
        borderTop={false}
        borderBottom={false}
      >
        <Box flexDirection="column" flexGrow={1} minHeight={0} paddingX={1}>
          {children}
        </Box>
      </Box>
      <StatusBar width={width} status={status} />
    </Box>
  );
}
