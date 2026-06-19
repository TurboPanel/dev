import React from "react";
import { Box, Text } from "ink";

export function StatusLine({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean | null;
  detail: string;
}) {
  const symbol = ok === null ? "?" : ok ? "✓" : "○";
  const color = ok === null ? "yellow" : ok ? "green" : "yellow";
  return (
    <Box>
      <Text color={color}>{symbol} </Text>
      <Text>{label}</Text>
      <Text dimColor> — {detail}</Text>
    </Box>
  );
}
