import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { ansibleSpinnerFrames } from "../lib/spinners.ts";

export type AnsibleTaskRow = {
  id: string;
  label: string;
  status: "running" | "ok" | "changed" | "failed" | "skipped";
  /** 0 = console step, 1 = Ansible play, 2 = Ansible task */
  depth: number;
};

function statusGlyph(status: AnsibleTaskRow["status"]): {
  glyph: string;
  color: string;
} {
  switch (status) {
    case "running":
      return { glyph: "▸", color: "cyan" };
    case "ok":
      return { glyph: "✓", color: "green" };
    case "changed":
      return { glyph: "~", color: "yellow" };
    case "failed":
      return { glyph: "✗", color: "red" };
    case "skipped":
      return { glyph: "–", color: "gray" };
  }
}

function indentForDepth(depth: number): string {
  return depth <= 0 ? "" : "  ".repeat(depth);
}

function truncateLabel(text: string, maxWidth: number): string {
  if (maxWidth < 4) return "…";
  if (text.length <= maxWidth) return text;
  return `${text.slice(0, maxWidth - 1)}…`;
}

function RunningGlyph({
  depth,
  dimmed,
}: {
  depth: number;
  dimmed: boolean;
}) {
  const frames = ansibleSpinnerFrames(depth);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((value) => (value + 1) % frames.length);
    }, 120);
    return () => clearInterval(timer);
  }, [frames.length]);

  const color = depth >= 2 ? "yellow" : "cyan";

  return (
    <Text color={dimmed ? "gray" : color}>{frames[index]}</Text>
  );
}

function TaskRow({
  task,
  columns,
  dimmed = false,
}: {
  task: AnsibleTaskRow;
  columns: number;
  dimmed?: boolean;
}) {
  const { glyph, color } = statusGlyph(task.status);
  const indent = indentForDepth(task.depth);
  const labelWidth = Math.max(
    8,
    columns - indent.length - (task.status === "running" ? 2 : 2),
  );
  const label = truncateLabel(task.label, labelWidth);

  const runningColor = task.depth >= 2 ? "yellow" : "cyan";

  return (
    <Box flexDirection="row">
      <Text>{indent}</Text>
      {task.status === "running" ? (
        <RunningGlyph depth={task.depth} dimmed={dimmed} />
      ) : (
        <Text color={dimmed ? "gray" : color}>{glyph}</Text>
      )}
      <Text> </Text>
      <Text
        color={task.status === "running" && !dimmed ? runningColor : undefined}
        dimColor={dimmed || task.status !== "running"}
        bold={task.status === "running" && !dimmed}
      >
        {label}
      </Text>
    </Box>
  );
}

export function AnsibleTaskList({
  steps,
  activePlay,
  recentTasks,
  hiddenTaskCount,
  recap,
  error,
  errorLogPath,
  columns,
}: {
  steps: AnsibleTaskRow[];
  activePlay: AnsibleTaskRow | null;
  recentTasks: AnsibleTaskRow[];
  hiddenTaskCount: number;
  recap: string | null;
  error: string | null;
  errorLogPath?: string | null;
  columns: number;
}) {
  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
      <Box flexDirection="column" flexShrink={1} minHeight={0}>
        {steps.map((task) => (
          <TaskRow key={task.id} task={task} columns={columns} />
        ))}
        {activePlay && (
          <TaskRow key={activePlay.id} task={activePlay} columns={columns} />
        )}
        {hiddenTaskCount > 0 && (
          <Text dimColor>… {hiddenTaskCount} earlier tasks</Text>
        )}
        {recentTasks.map((task) => (
          <TaskRow key={task.id} task={task} columns={columns} />
        ))}
      </Box>
      <Box flexShrink={0} flexDirection="column" marginTop={1}>
        {recap && <Text dimColor>{recap}</Text>}
        {error && (
          <Box marginTop={1} flexDirection="column">
            <Text color="red" bold>Error</Text>
            <Text color="red">{error}</Text>
            {errorLogPath && (
              <Text dimColor>Details saved to {errorLogPath}</Text>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
