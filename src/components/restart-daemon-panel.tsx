import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { restartDaemon } from "../lib/daemon-actions.ts";
import { appendOutputLines } from "../lib/install-output.ts";
import { INSTALL_SPINNER_FRAMES } from "../lib/spinners.ts";
import { MENU_BLUE, STATUS_RUNNING } from "../theme.ts";

const OUTPUT_LOG_ROWS = 6;

function truncateLine(text: string, maxWidth: number): string {
  if (maxWidth < 4) return "…";
  if (text.length <= maxWidth) return text;
  return `${text.slice(0, maxWidth - 1)}…`;
}

export function RestartDaemonPanel({
  width,
  height,
  onDone,
  onInstallFinished,
}: {
  width: number;
  height: number;
  onDone: () => void;
  onInstallFinished?: (success: boolean) => void;
}) {
  const [spinnerIndex, setSpinnerIndex] = useState(0);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const finished = done || error !== null;
  const outputWidth = Math.max(20, width);

  const appendOutput = useCallback((line: string) => {
    setOutputLines((lines) => appendOutputLines(lines, line, OUTPUT_LOG_ROWS));
  }, []);

  useEffect(() => {
    if (finished) {
      return;
    }
    const timer = setInterval(() => {
      setSpinnerIndex((value) => (value + 1) % INSTALL_SPINNER_FRAMES.length);
    }, 120);
    return () => clearInterval(timer);
  }, [finished]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await restartDaemon(appendOutput);
        if (cancelled) return;
        setDone(true);
      } catch (caught) {
        if (cancelled) return;
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appendOutput]);

  useEffect(() => {
    if (done) {
      onInstallFinished?.(true);
    }
  }, [done, onInstallFinished]);

  useEffect(() => {
    if (error !== null) {
      onInstallFinished?.(false);
    }
  }, [error, onInstallFinished]);

  useInput(() => {
    if (finished) {
      onDone();
    }
  });

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text color={MENU_BLUE} bold>
        Restart Daemon
      </Text>
      {!finished && (
        <Box marginTop={1}>
          <Text color={MENU_BLUE}>
            {INSTALL_SPINNER_FRAMES[spinnerIndex]} Restarting daemon...
          </Text>
        </Box>
      )}
      {error && outputLines.length > 0 && (
        <Box flexDirection="column" marginTop={1} flexGrow={1} minHeight={0}>
          <Text dimColor>Output</Text>
          {outputLines.map((line, index) => (
            <Text key={`${index}:${line}`} dimColor wrap="truncate">
              {truncateLine(line, outputWidth)}
            </Text>
          ))}
        </Box>
      )}
      {done && (
        <Box marginTop={1}>
          <Text color={STATUS_RUNNING}>Daemon restarted successfully</Text>
        </Box>
      )}
      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}
      {finished && (
        <Box marginTop={1}>
          <Text dimColor>Press any key to return</Text>
        </Box>
      )}
    </Box>
  );
}
