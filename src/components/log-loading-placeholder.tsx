import React from "react";
import { Box, Text } from "ink";
import { INSTALL_SPINNER_FRAMES } from "../lib/spinners.ts";
import { useSpinnerFrame } from "../hooks/use-spinner-frame.ts";
import { MENU_BLUE } from "../theme.ts";

export function LogLoadingPlaceholder({
  width,
  height,
}: Readonly<{
  width: number;
  height: number;
}>) {
  const frame = useSpinnerFrame(120);
  const glyph = INSTALL_SPINNER_FRAMES[frame % INSTALL_SPINNER_FRAMES.length];

  return (
    <Box width={width} height={height} flexDirection="column">
      <Text color={MENU_BLUE} dimColor>
        {glyph} Loading logs…
      </Text>
    </Box>
  );
}
