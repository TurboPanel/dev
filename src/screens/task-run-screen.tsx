import React from "react";
import { Box, Text, useInput } from "@deno-ink/core";
import {
  AnsibleTaskList,
  type AnsibleTaskRow,
} from "@turbopanel/components/ansible-task-list.tsx";
import { useTerminalLayout } from "@turbopanel/hooks/use-terminal-layout.ts";

export function TaskRunScreen({
  title,
  tasks,
  recap,
  error,
  done,
  onDone,
}: {
  title: string;
  tasks: AnsibleTaskRow[];
  recap: string | null;
  error: string | null;
  done: boolean;
  onDone: () => void;
}) {
  const { columns, appHeight } = useTerminalLayout(1);

  useInput(() => {
    if (done) {
      onDone();
    }
  });

  return (
    <Box flexDirection="column" width={columns} height={appHeight} paddingX={1}>
      <Text bold color="cyan">{title}</Text>
      <AnsibleTaskList
        tasks={tasks}
        recap={recap}
        error={error}
        columns={columns}
      />
      {done && !error && <Text dimColor>Press any key to return</Text>}
      {done && error && (
        <>
          <Text color="red">Task failed — press any key to return</Text>
          <Text dimColor>Press any key to return</Text>
        </>
      )}
    </Box>
  );
}
