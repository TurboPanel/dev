import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { purgeDaemon } from "../lib/daemon-actions.ts";
import { appendOutputLines } from "../lib/install-output.ts";
import { PURGE_SPINNER_FRAMES } from "../lib/spinners.ts";
import { STATUS_UNINSTALLED } from "../theme.ts";

const OUTPUT_LOG_ROWS = 6;

function truncateLine(text: string, maxWidth: number): string {
  if (maxWidth < 4) return "…";
  if (text.length <= maxWidth) return text;
  return `${text.slice(0, maxWidth - 1)}…`;
}

export function PurgeDaemonPanel({
  width,
  height,
  onDone,
}: {
  width: number;
  height: number;
  onDone: () => void;
}) {
  const [spinnerIndex, setSpinnerIndex] = useState(0);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const outputWidth = Math.max(20, width);

  const appendOutput = useCallback((line: string) => {
    setOutputLines((lines) => appendOutputLines(lines, line, OUTPUT_LOG_ROWS));
  }, []);

  useEffect(() => {
    if (error !== null) {
      return;
    }
    const timer = setInterval(() => {
      setSpinnerIndex((value) => (value + 1) % PURGE_SPINNER_FRAMES.length);
    }, 120);
    return () => clearInterval(timer);
  }, [error]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await purgeDaemon(appendOutput);
        if (cancelled) return;
        onDone();
      } catch (caught) {
        if (cancelled) return;
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appendOutput, onDone]);

  useInput(() => {
    if (error !== null) {
      onDone();
    }
  });

  if (error === null) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Text color={STATUS_UNINSTALLED} bold>
          Purge Daemon
        </Text>
        <Box marginTop={1}>
          <Text color={STATUS_UNINSTALLED}>
            {PURGE_SPINNER_FRAMES[spinnerIndex]} Purging daemon...
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text color={STATUS_UNINSTALLED} bold>
        Purge Daemon
      </Text>
      {outputLines.length > 0 && (
        <Box flexDirection="column" marginTop={1} flexGrow={1} minHeight={0}>
          <Text dimColor>Output</Text>
          {outputLines.map((line, index) => (
            <Text key={`${index}:${line}`} dimColor wrap="truncate">
              {truncateLine(line, outputWidth)}
            </Text>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="red">{error}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press any key to return</Text>
      </Box>
    </Box>
  );
}
