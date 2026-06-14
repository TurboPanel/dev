import React, { useCallback, useEffect, useState } from "react";
import { Box, Text } from "@deno-ink/core";
import { readInstanceRuntime } from "@turbopanel/instance-runtime";
import { wranglerProcessRunning } from "@turbopanel/stack-status";

const JOURNAL_UNITS = [
  "turbopanel-daemon",
  "turbopanel-instance",
  "turbopanel-caddy",
  "turbopanel-ui",
  "turbopanel-rabbitmq",
] as const;

const POLL_MS = 2_000;
const MAX_LINES = 18;

async function fetchJournalLines(): Promise<string[]> {
  const proc = await new Deno.Command("journalctl", {
    args: [
      "-n",
      String(MAX_LINES),
      "--no-pager",
      "--output=short-iso",
      ...JOURNAL_UNITS.flatMap((unit) => ["-u", unit]),
    ],
    stdout: "piped",
    stderr: "null",
  }).output();

  if (!proc.success) {
    return ["(journalctl unavailable — need systemd access)"];
  }

  const text = new TextDecoder().decode(proc.stdout).trim();
  if (!text) return ["(no journal lines yet)"];
  return text.split("\n").slice(-MAX_LINES);
}

export function LogsSection({ live = true }: { live?: boolean }) {
  const [lines, setLines] = useState<string[]>(["(loading logs…)"]);
  const runtime = readInstanceRuntime();

  const refresh = useCallback(async () => {
    setLines(await fetchJournalLines());
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
      <Text dimColor>
        journalctl · {JOURNAL_UNITS.join(", ")}
        {runtime === "workers"
          ? wranglerProcessRunning()
            ? " · turbopanel-instance.service active"
            : " · start turbopanel-instance.service"
          : ""}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {lines.map((line, index) => (
          <Text key={`${index}-${line.slice(0, 24)}`} wrap="truncate">
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
