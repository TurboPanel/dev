import React from "react";
import { Box, Text } from "ink";
import { ScrollList } from "ink-scroll-list";
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
  spinnerFrame,
}: {
  depth: number;
  dimmed: boolean;
  spinnerFrame: number;
}) {
  const frames = ansibleSpinnerFrames(depth);
  const index = spinnerFrame % frames.length;
  const color = depth >= 2 ? "yellow" : "cyan";

  return (
    <Text color={dimmed ? "gray" : color}>{frames[index]}</Text>
  );
}

function TaskRow({
  task,
  columns,
  dimmed = false,
  focused = false,
  spinnerFrame,
}: {
  task: AnsibleTaskRow;
  columns: number;
  dimmed?: boolean;
  focused?: boolean;
  spinnerFrame: number;
}) {
  const { glyph, color } = statusGlyph(task.status);
  const indent = indentForDepth(task.depth);
  const labelWidth = Math.max(
    8,
    columns - indent.length - (task.status === "running" ? 2 : 2),
  );
  const label = truncateLabel(task.label, labelWidth);

  const runningColor = task.depth >= 2 ? "yellow" : "cyan";
  const isRunning = task.status === "running";
  const showDimmed = dimmed && !isRunning && task.status !== "failed";

  return (
    <Box flexDirection="row">
      <Text>{indent}</Text>
      {isRunning ? (
        <RunningGlyph depth={task.depth} dimmed={showDimmed} spinnerFrame={spinnerFrame} />
      ) : (
        <Text color={showDimmed ? "gray" : color}>{glyph}</Text>
      )}
      <Text> </Text>
      <Text
        color={isRunning && !showDimmed ? runningColor : undefined}
        dimColor={showDimmed || !isRunning}
        bold={isRunning && (focused || !showDimmed)}
      >
        {label}
      </Text>
    </Box>
  );
}

export function AnsibleTaskList({
  visibleTasks,
  hiddenCount,
  followIndex,
  height,
  recap,
  error,
  errorLogPath,
  columns,
  spinnerFrame,
}: {
  visibleTasks: AnsibleTaskRow[];
  hiddenCount: number;
  followIndex: number;
  height: number;
  recap: string | null;
  error: string | null;
  errorLogPath?: string | null;
  columns: number;
  spinnerFrame: number;
}) {
  const scrollHeight = Math.max(1, height);
  const scrollIndex = visibleTasks.length === 0
    ? 0
    : Math.min(followIndex, visibleTasks.length - 1);

  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
      <Box flexDirection="column" flexShrink={1} minHeight={0} height={scrollHeight}>
        {hiddenCount > 0 && (
          <Text dimColor>… {hiddenCount} earlier tasks</Text>
        )}
        <ScrollList
          height={hiddenCount > 0 ? Math.max(1, scrollHeight - 1) : scrollHeight}
          selectedIndex={scrollIndex}
          scrollAlignment="bottom"
        >
          {visibleTasks.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              columns={columns}
              dimmed={index < scrollIndex - 1}
              focused={index === scrollIndex}
              spinnerFrame={spinnerFrame}
            />
          ))}
        </ScrollList>
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
