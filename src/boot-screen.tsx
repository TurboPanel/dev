import React from "react";
import { Box, Text, useTerminalSize } from "@deno-ink/core";

export function BootScreen({ message }: { message: string }) {
  const { rows, columns } = useTerminalSize(250);
  return (
    <Box height={rows} width={columns} flexDirection="column" paddingX={1}>
      <Text bold color="cyan">TurboPanel Dev Console</Text>
      <Text dimColor>{message}</Text>
    </Box>
  );
}
