import React from "react";
import { Box } from "@deno-ink/core";

/**
 * Full-terminal shell, flexbox style (like Ink's useStdoutDimensions pattern):
 *   ┌ menu bar  (flexShrink 0)
 *   │ main      (flexGrow 1, flexShrink 1) ← fills remaining rows
 *   └ status bar(flexShrink 0)
 *
 * NOTE: Ink/Yoga default `flexShrink` to 0 (not 1 like CSS). The main area MUST
 * set flexShrink={1} + minHeight={0} or tall content shoves the footer off-screen.
 */
export function AppShell({
  height,
  columns,
  menuBar,
  main,
  statusBar,
}: {
  height: number;
  columns: number;
  menuBar: React.ReactNode;
  main: React.ReactNode;
  statusBar: React.ReactNode;
}) {
  return (
    <Box flexDirection="column" width={columns} height={height}>
      <Box flexShrink={0} paddingX={1}>
        {menuBar}
      </Box>

      <Box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        paddingX={1}
      >
        {main}
      </Box>

      <Box flexShrink={0} flexDirection="column" paddingX={1}>
        {statusBar}
      </Box>
    </Box>
  );
}
