import React, { useCallback, useEffect, useState } from "react";
import { Box, Text } from "@deno-ink/core";
import { readInstanceRuntime } from "@turbopanel/instance-runtime";
import { fetchStackLogLines, type StackLogLine } from "@turbopanel/stack-logs";
import { wranglerProcessRunning } from "@turbopanel/stack-status";

const POLL_MS = 2_000;
const MAX_LINES = 18;

export function LogsSection({ live = true }: { live?: boolean }) {
  const [header, setHeader] = useState("(loading logs…)");
  const [lines, setLines] = useState<StackLogLine[]>([
    { source: "…", text: "(loading logs…)" },
  ]);
  const runtime = readInstanceRuntime();

  const refresh = useCallback(async () => {
    const result = await fetchStackLogLines(MAX_LINES);
    setHeader(result.header);
    setLines(result.lines);
  }, []);

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
      <Text bold>Logs</Text>
      <Text dimColor>{"─".repeat(40)}</Text>
      <Text dimColor>
        {header}
        {runtime === "workers"
          ? wranglerProcessRunning()
            ? " · turbopanel-instance.service active"
            : " · start turbopanel-instance.service"
          : ""}
      </Text>
      <Text dimColor>
        /var/log/turbopanel/instance/*.log, daemon/*.log (journalctl fallback)
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
