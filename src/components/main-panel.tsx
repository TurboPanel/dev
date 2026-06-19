import React, { type ReactNode } from "react";
import { Box } from "ink";

export function MainPanel({
  width,
  children,
}: {
  width: number;
  children: ReactNode;
}) {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      minHeight={0}
      width={width}
      borderStyle="round"
    >
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {children}
      </Box>
    </Box>
  );
}
