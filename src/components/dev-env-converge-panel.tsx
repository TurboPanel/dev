import React, { useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { AnsibleTaskList } from "@turbopanel/components/ansible-task-list.tsx";
import {
  buildAnsibleTaskView,
} from "../hooks/use-ansible-events.ts";
import type { DevEnvConvergeState } from "../hooks/use-dev-env-converge.ts";

export function DevEnvConvergePanel({
  width,
  height,
  converge,
  onDismissError,
}: {
  width: number;
  height: number;
  converge: DevEnvConvergeState;
  onDismissError?: () => void;
}) {
  const finished = !converge.active && converge.error === null;
  const footerRows = converge.error ? (converge.errorLogPath ? 3 : 2) : 0;
  const taskRowBudget = Math.max(3, height - 2 - footerRows);
  const view = useMemo(
    () => buildAnsibleTaskView(converge.tasks, taskRowBudget),
    [converge.tasks, taskRowBudget],
  );

  useInput(() => {
    if (converge.error && onDismissError) {
      onDismissError();
    }
  });

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1}>
      <Text color="cyan" bold>
        {converge.active ? "Converging development environment…" : "Development environment converge"}
      </Text>
      <Box flexDirection="column" marginTop={1} flexGrow={1} minHeight={0}>
        <AnsibleTaskList
          visibleTasks={view.visibleTasks}
          hiddenCount={view.hiddenCount}
          followIndex={view.followIndex}
          height={taskRowBudget}
          recap={converge.recap}
          error={converge.error}
          errorLogPath={converge.errorLogPath}
          columns={Math.max(20, width - 2)}
        />
      </Box>
      {finished && !converge.error && converge.recap && (
        <Box marginTop={1}>
          <Text color="green">Development environment ready · {converge.recap}</Text>
        </Box>
      )}
      {converge.error && (
        <Box marginTop={1}>
          <Text dimColor>Press any key to continue</Text>
        </Box>
      )}
    </Box>
  );
}
