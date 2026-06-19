import React, { type ReactNode } from "react";
import { Box } from "ink";
import { ACTIVE_TAB_BG, DARK_GREY } from "../theme.ts";

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
      backgroundColor={DARK_GREY}
      borderStyle="round"
      borderColor={ACTIVE_TAB_BG}
      borderBackgroundColor={DARK_GREY}
      borderLeft
      borderRight
      borderTop={false}
      borderBottom={false}
    >
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {children}
      </Box>
    </Box>
  );
}
