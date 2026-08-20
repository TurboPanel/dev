import React from "react";
import { Box, Text, useWindowSize } from "ink";

export function BootScreen({ message }: Readonly<{ message: string }>) {
  const { columns, rows } = useWindowSize();

  return (
    <Box flexDirection="column" width={columns} height={rows} paddingX={1}>
      <Text bold color="cyan">TurboPanel Dev Console</Text>
      <Text dimColor>{message}</Text>
    </Box>
  );
}
