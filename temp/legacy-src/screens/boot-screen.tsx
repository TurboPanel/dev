import React from "react";
import { Box, Text } from "ink";
import { useTerminalLayout } from "@turbopanel/hooks/use-terminal-layout.ts";

export function BootScreen({ message }: { message: string }) {
  const { columns, appHeight } = useTerminalLayout(1);

  return (
    <Box flexDirection="column" width={columns} height={appHeight} paddingX={1}>
      <Text bold color="cyan">TurboPanel Dev Console</Text>
      <Text dimColor>{message}</Text>
    </Box>
  );
}
