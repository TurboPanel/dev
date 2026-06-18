import React from "react";
import { Box, Text } from "@deno-ink/core";

export type AnsibleTaskRow = {
  id: string;
  label: string;
  status: "running" | "ok" | "changed" | "failed" | "skipped";
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

export function AnsibleTaskList({
  tasks,
  recap,
  error,
  columns,
}: {
  tasks: AnsibleTaskRow[];
  recap: string | null;
  error: string | null;
  columns: number;
}) {
  const labelWidth = Math.max(10, columns - 4);

  return (
    <Box flexDirection="column">
      {tasks.map((task) => {
        const { glyph, color } = statusGlyph(task.status);
        const label = task.label.length > labelWidth
          ? `${task.label.slice(0, labelWidth - 1)}…`
          : task.label;
        return (
          <Text key={task.id} wrap="truncate">
            <Text color={color}>{glyph} </Text>
            {label}
          </Text>
        );
      })}
      {recap && <Text dimColor>{recap}</Text>}
      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}
