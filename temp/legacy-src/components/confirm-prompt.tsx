import React from "react";
import { Box, Text, useInput } from "ink";

export function ConfirmPrompt({
  question,
  onConfirm,
}: {
  question: string;
  onConfirm: (confirmed: boolean) => void;
}) {
  useInput((input) => {
    if (input === "y" || input === "Y") {
      onConfirm(true);
      return;
    }
    if (input === "n" || input === "N" || input === "\r" || input === "\n") {
      onConfirm(false);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{question}</Text>
      <Text dimColor>[y/N]</Text>
    </Box>
  );
}
