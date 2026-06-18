import React from "react";
import { Box, Text } from "@deno-ink/core";

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
  const prefix = `${indent}${glyph} `;
  const label = truncateLabel(task.label, Math.max(8, columns - prefix.length));
  return (
    <Box flexDirection="row">
      <Text color={dimmed ? "gray" : color}>{prefix}</Text>
      <Text dimColor={dimmed}>{label}</Text>
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
  columns,
}: {
  steps: AnsibleTaskRow[];
  activePlay: AnsibleTaskRow | null;
  recentTasks: AnsibleTaskRow[];
  hiddenTaskCount: number;
  recap: string | null;
  error: string | null;
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
          </Box>
        )}
      </Box>
    </Box>
  );
}
