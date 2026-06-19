import React, { useCallback, useEffect, useState } from "react";
import { Box, Text } from "@deno-ink/core";
import { fetchStackLogLines, type StackLogLine } from "@turbopanel/lib/stack-logs.ts";
import { CONSOLE_LAST_TASK_ERROR_LOG } from "@turbopanel/lib/paths.ts";

const POLL_MS = 3_000;

export function LogsSection({
  live = true,
  maxLines = 8,
}: {
  live?: boolean;
  maxLines?: number;
}) {
  const [header, setHeader] = useState("(loading logs…)");
  const [lines, setLines] = useState<StackLogLine[]>([
    { source: "…", text: "(loading logs…)" },
  ]);

  const refresh = useCallback(async () => {
    const result = await fetchStackLogLines(maxLines);
    setHeader(result.header);
    setLines(result.lines);
  }, [maxLines]);

  useEffect(() => {
    void refresh();
    if (!live) return;
    const timer = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [live, refresh]);

  return (
    <Box flexDirection="column">
      <Text dimColor>{header}</Text>
      <Text dimColor>
        Task errors: {CONSOLE_LAST_TASK_ERROR_LOG} · m → Follow logs (fullscreen)
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {lines.map((line, index) => (
          <Text key={`${index}-${line.source}-${line.text.slice(0, 24)}`} wrap="truncate">
            <Text dimColor>[{line.source}] </Text>
            {line.text}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
