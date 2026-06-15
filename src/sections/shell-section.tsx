import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "@deno-ink/core";
import {
  daemonLabel,
  runCommand,
  runCommandOnAll,
} from "@turbopanel/instance-client";
import { ALL_TARGET } from "@turbopanel/use-developer-state";
import type { DeveloperState } from "@turbopanel/use-developer-state";

const MAX_LINE = 120;

function truncate(text: string, max = MAX_LINE): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

export function ShellSection({
  state,
  interactable = false,
  onEditingChange,
  maxLines = 8,
}: {
  state: DeveloperState;
  interactable?: boolean;
  onEditingChange?: (editing: boolean) => void;
  maxLines?: number;
}) {
  const { healthOk, connections, commands, fleet, target, targetLabel, refresh } =
    state;
  const [command, setCommand] = useState("uname -a");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);

  useEffect(() => {
    onEditingChange?.(inputFocused);
    return () => onEditingChange?.(false);
  }, [inputFocused, onEditingChange]);

  const canRun = !running && healthOk === true && fleet.length > 0;

  const onRun = async () => {
    const trimmed = command.trim();
    if (!trimmed) return;
    setRunning(true);
    setError(null);
    try {
      if (target === ALL_TARGET) {
        await runCommandOnAll(trimmed);
      } else {
        await runCommand(target, trimmed);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Command failed");
    } finally {
      setRunning(false);
    }
  };

  useInput((input, key) => {
    if (!inputFocused) {
      if (interactable && input === "i") {
        setInputFocused(true);
      }
      return;
    }

    if (key.escape) {
      setInputFocused(false);
      return;
    }
    if (key.return && canRun) {
      void onRun();
      return;
    }
    if (key.backspace || key.delete) {
      setCommand((value) => value.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setCommand((value) => value + input);
    }
  });

  return (
    <Box flexDirection="column">
      <Text dimColor>Run on {targetLabel}</Text>
      <Box marginTop={1}>
        <Text color="cyan">$ </Text>
        <Text color={inputFocused ? "cyan" : undefined}>
          {command}{running ? " …" : ""}
        </Text>
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {commands.length === 0 ? (
          <Text dimColor>No commands run yet</Text>
        ) : (
          [...commands].reverse().slice(0, maxLines).map((result) => (
            <Box key={result.id} flexDirection="column" marginTop={1}>
              <Text>
                {daemonLabel(result.daemonId, connections)} · exit{" "}
                {result.exitCode ?? "?"} · {result.status}
              </Text>
              <Text dimColor>{truncate(result.command)}</Text>
              {result.stdout ? <Text dimColor>{truncate(result.stdout)}</Text> : null}
              {result.stderr ? (
                <Text color="red">{truncate(result.stderr)}</Text>
              ) : null}
            </Box>
          ))
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {!interactable
            ? "Enter to focus"
            : inputFocused
            ? "Enter run · Esc blur command"
            : "i focus command · Esc back"}
        </Text>
      </Box>
    </Box>
  );
}
