import React from "react";
import { Box, Text } from "ink";

export function StatusBar({ columns }: { columns: number }) {
  return (
    <Box flexDirection="row" width={columns} height={1}>
      <Text dimColor wrap="truncate">
        ← → switch areas · Ctrl-C exit
      </Text>
    </Box>
  );
}
