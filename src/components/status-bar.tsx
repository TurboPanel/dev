import React from "react";
import { Box, Text } from "ink";
import { ACTIVE_TAB_BG, DARK_GREY } from "../theme.ts";

export function StatusBar({ columns }: { columns: number }) {
  return (
    <Box
      flexDirection="row"
      width={columns}
      height={1}
      paddingX={1}
      backgroundColor={DARK_GREY}
      borderStyle="round"
      borderColor={ACTIVE_TAB_BG}
      borderBackgroundColor={DARK_GREY}
      borderBottom
      borderLeft
      borderRight
      borderTop={false}
    >
      <Text dimColor wrap="truncate">
        ← → switch areas · Ctrl-C exit
      </Text>
    </Box>
  );
}
