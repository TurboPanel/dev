import React, { useState } from "react";
import { Box, Text, useInput } from "@deno-ink/core";

export function RuntimeSelectPrompt({
  onSelect,
}: {
  onSelect: (target: "deno" | "workers" | null) => void;
}) {
  const [index, setIndex] = useState(0);
  const options = [
    { label: "Self-hosted Deno instance", value: "deno" as const },
    { label: "Cloudflare Workers (wrangler dev)", value: "workers" as const },
  ];

  useInput((input, key) => {
    if (key.upArrow) {
      setIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow) {
      setIndex((current) => Math.min(options.length - 1, current + 1));
      return;
    }
    if (key.escape) {
      onSelect(null);
      return;
    }
    if (key.return) {
      onSelect(options[index].value);
      return;
    }
    if (input === "1") {
      onSelect("deno");
      return;
    }
    if (input === "2") {
      onSelect("workers");
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Reset turbopanel development environment</Text>
      <Text>Which runtime should start fresh after the reset?</Text>
      {options.map((option, optionIndex) => (
        <Text
          key={option.value}
          color={optionIndex === index ? "cyan" : undefined}
          bold={optionIndex === index}
        >
          {optionIndex === index ? "› " : "  "}
          {optionIndex + 1}) {option.label}
        </Text>
      ))}
      <Text dimColor>↑↓ select · Enter confirm · Esc cancel</Text>
    </Box>
  );
}
