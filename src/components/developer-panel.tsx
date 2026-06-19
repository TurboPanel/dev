import React from "react";
import { Box, Text } from "ink";

export function DeveloperPanel() {
  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
      <Text bold>Welcome to the TurboPanel Developer Console</Text>
      <Text dimColor>{"Use ← → to switch tabs · Ctrl-C to exit"}</Text>
    </Box>
  );
}
