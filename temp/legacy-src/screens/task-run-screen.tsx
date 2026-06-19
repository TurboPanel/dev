import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { AnsibleTaskList } from "@turbopanel/components/ansible-task-list.tsx";
import {
  buildAnsibleTaskView,
} from "@turbopanel/hooks/use-ansible-events.ts";
import { useTerminalLayout } from "@turbopanel/hooks/use-terminal-layout.ts";

export function TaskRunScreen({
  title,
  tasks,
  recap,
  error,
  errorLogPath,
  done,
  onDone,
}: {
  title: string;
  tasks: import("@turbopanel/components/ansible-task-list.tsx").AnsibleTaskRow[];
  recap: string | null;
  error: string | null;
  errorLogPath?: string | null;
  done: boolean;
  onDone: () => void;
}) {
  const { columns, mainHeight } = useTerminalLayout(0);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const finished = done || error !== null;
  const busy = !finished;
  const hasRunningTask = tasks.some((task) => task.status === "running");

  const footerRows = finished
    ? (error ? (errorLogPath ? 3 : 2) : 1)
    : (busy && !hasRunningTask ? 1 : 0);
  const taskRowBudget = Math.max(4, mainHeight - 1 - footerRows);

  const view = useMemo(
    () => buildAnsibleTaskView(tasks, taskRowBudget),
    [tasks, taskRowBudget],
  );

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      setSpinnerFrame((frame) => (frame + 1) % 4);
    }, 120);
    return () => clearInterval(timer);
  }, [busy]);

  const spinner = ["⠋", "⠙", "⠹", "⠸"][spinnerFrame];

  useInput(() => {
    if (finished) {
      onDone();
    }
  });

  return (
    <Box flexDirection="column" width={columns} height={mainHeight}>
      <Box flexShrink={0}>
        <Text bold color="cyan">{title}</Text>
      </Box>
      <AnsibleTaskList
        steps={view.steps}
        activePlay={view.activePlay}
        recentTasks={view.recentTasks}
        hiddenTaskCount={view.hiddenTaskCount}
        recap={recap}
        error={error}
        errorLogPath={errorLogPath}
        columns={columns}
      />
      <Box flexShrink={0} flexDirection="column">
        {busy && !hasRunningTask && (
          <Text color="cyan">{spinner} Starting Ansible…</Text>
        )}
        {finished && !error && <Text dimColor>Press any key to return</Text>}
        {finished && error && (
          <Text color="red">Task failed — press any key to return</Text>
        )}
        {finished && error && errorLogPath && (
          <Text dimColor>Details saved to {errorLogPath}</Text>
        )}
      </Box>
    </Box>
  );
}
