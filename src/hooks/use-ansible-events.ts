import { useCallback, useState } from "react";
import type { AnsibleTaskRow } from "@turbopanel/components/ansible-task-list.tsx";
import { CONSOLE_LAST_TASK_ERROR_LOG } from "../lib/paths.ts";
import { writeTaskErrorLog } from "../lib/task-error-log.ts";

function parseTaskName(full: string): { role: string | null; task: string } {
  const match = full.match(/^\s*([^:]+)\s*:\s*(.+)$/);
  if (match) {
    return { role: match[1].trim(), task: match[2].trim() };
  }
  return { role: null, task: full.trim() };
}

function taskLabel(full: string): string {
  const { role, task } = parseTaskName(full);
  return role ? `${role} › ${task}` : task;
}

function hostMessages(hosts: Record<string, Record<string, unknown>>): string {
  const messages: string[] = [];
  for (const result of Object.values(hosts)) {
    const msg = result.msg;
    if (typeof msg === "string" && msg.length > 0) {
      messages.push(msg);
    }
  }
  return messages.join("; ");
}

function buildRecap(stats: Record<string, Record<string, number>>): string {
  let ok = 0;
  let changed = 0;
  let failed = 0;
  for (const hostStats of Object.values(stats)) {
    ok += hostStats.ok ?? 0;
    changed += hostStats.changed ?? 0;
    failed += hostStats.failures ?? hostStats.failed ?? 0;
  }
  return `ok=${ok} changed=${changed} failed=${failed}`;
}

function upsertTask(
  tasks: AnsibleTaskRow[],
  row: AnsibleTaskRow,
): AnsibleTaskRow[] {
  const index = tasks.findIndex((task) => task.id === row.id);
  if (index < 0) {
    return [...tasks, row];
  }
  const next = [...tasks];
  next[index] = row;
  return next;
}

function completeRunning(
  tasks: AnsibleTaskRow[],
  finalStatus: AnsibleTaskRow["status"],
): AnsibleTaskRow[] {
  return tasks.map((task) =>
    task.status === "running" ? { ...task, status: finalStatus } : task
  );
}

export type AnsibleTaskView = {
  visibleTasks: AnsibleTaskRow[];
  hiddenCount: number;
  followIndex: number;
};

function pinnedIndices(tasks: AnsibleTaskRow[]): number[] {
  const indices: number[] = [];
  for (let index = 0; index < tasks.length; index += 1) {
    const status = tasks[index]!.status;
    if (status === "running" || status === "failed") {
      indices.push(index);
    }
  }
  return indices;
}

/** Slide a row budget over the chronological task list, keeping active work in view. */
export function buildAnsibleTaskView(
  tasks: AnsibleTaskRow[],
  maxRows: number,
): AnsibleTaskView {
  if (tasks.length === 0) {
    return { visibleTasks: [], hiddenCount: 0, followIndex: 0 };
  }

  const budget = Math.max(1, maxRows);
  const needsHidden = tasks.length > budget;
  const windowRows = needsHidden ? Math.max(1, budget - 1) : budget;

  const pinned = pinnedIndices(tasks);
  const focusIndex = pinned.length > 0
    ? pinned[pinned.length - 1]!
    : tasks.length - 1;

  let start = Math.max(0, focusIndex - windowRows + 1);
  let end = start + windowRows;

  if (pinned.length > 0) {
    start = Math.min(start, pinned[0]!);
    end = Math.max(end, pinned[pinned.length - 1]! + 1);
  }

  if (end - start > windowRows) {
    start = Math.max(0, end - windowRows);
  }
  if (end > tasks.length) {
    end = tasks.length;
    start = Math.max(0, end - windowRows);
  }

  const visibleTasks = tasks.slice(start, end);
  const followIndex = Math.min(
    Math.max(0, focusIndex - start),
    Math.max(0, visibleTasks.length - 1),
  );

  return {
    visibleTasks,
    hiddenCount: start,
    followIndex,
  };
}

export function useAnsibleEvents() {
  const [tasks, setTasks] = useState<AnsibleTaskRow[]>([]);
  const [recap, setRecap] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorLogPath, setErrorLogPath] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = useCallback(() => {
    setTasks([]);
    setRecap(null);
    setError(null);
    setErrorLogPath(null);
    setDone(false);
  }, []);

  const emitStep = useCallback((
    label: string,
    status: AnsibleTaskRow["status"],
    id?: string,
  ) => {
    const stepId = id ?? `step:${label}`;
    setTasks((current) => {
      let next = current;
      if (status === "running") {
        next = current.map((task) =>
          task.depth === 0 && task.status === "running" && task.id !== stepId
            ? { ...task, status: "ok" as const }
            : task
        );
      }
      return upsertTask(next, { id: stepId, label, status, depth: 0 });
    });
  }, []);

  const onEvent = useCallback((event: unknown) => {
    if (typeof event !== "object" || event === null) return;
    const record = event as Record<string, unknown>;
    const eventType = record._event;
    if (typeof eventType !== "string") return;

    if (eventType === "v2_playbook_on_play_start") {
      const play = record.play as { name?: string; uuid?: string } | undefined;
      const name = play?.name?.trim() || "play";
      const playId = typeof play?.uuid === "string"
        ? `play:${play.uuid}`
        : `play:${name}`;
      setTasks((current) => {
        const closed = current.map((task) =>
          task.depth === 1 && task.status === "running"
            ? { ...task, status: "ok" as const }
            : task
        );
        return upsertTask(closed, {
          id: playId,
          label: name,
          status: "running",
          depth: 1,
        });
      });
      return;
    }

    if (
      eventType === "v2_playbook_on_task_start" ||
      eventType === "v2_playbook_on_handler_task_start" ||
      eventType === "v2_runner_on_start"
    ) {
      const task = record.task as { id?: string; name?: string } | undefined;
      const rawName = task?.name ?? "task";
      const id = typeof task?.id === "string" ? `task:${task.id}` : `task:${rawName}`;
      setTasks((current) =>
        upsertTask(current, {
          id,
          label: taskLabel(rawName),
          status: "running",
          depth: 2,
        })
      );
      return;
    }

    if (
      eventType === "v2_runner_on_ok" ||
      eventType === "v2_runner_on_failed" ||
      eventType === "v2_runner_on_unreachable" ||
      eventType === "v2_runner_on_skipped"
    ) {
      const task = record.task as { id?: string; name?: string } | undefined;
      const rawName = task?.name ?? "task";
      const id = typeof task?.id === "string" ? `task:${task.id}` : `task:${rawName}`;
      const hosts = record.hosts as
        | Record<string, Record<string, unknown>>
        | undefined;

      if (eventType === "v2_runner_on_ok") {
        const hostResult = hosts ? Object.values(hosts)[0] : undefined;
        const changed = hostResult?.changed === true;
        setTasks((current) =>
          upsertTask(current, {
            id,
            label: taskLabel(rawName),
            status: changed ? "changed" : "ok",
            depth: 2,
          })
        );
        return;
      }

      if (eventType === "v2_runner_on_skipped") {
        setTasks((current) =>
          upsertTask(current, {
            id,
            label: taskLabel(rawName),
            status: "skipped",
            depth: 2,
          })
        );
        return;
      }

      const message = hosts ? hostMessages(hosts) : "task failed";
      setTasks((current) =>
        upsertTask(current, {
          id,
          label: taskLabel(rawName),
          status: "failed",
          depth: 2,
        })
      );
      setError(message);
      void writeTaskErrorLog({
        title: "Ansible converge",
        message,
        timestamp: new Date().toISOString(),
      }).then((saved) => {
        if (saved) {
          setErrorLogPath(CONSOLE_LAST_TASK_ERROR_LOG);
        }
      });
      return;
    }

    if (eventType === "v2_playbook_on_stats") {
      const stats = record.stats as
        | Record<string, Record<string, number>>
        | undefined;
      let failed = 0;
      if (stats) {
        for (const hostStats of Object.values(stats)) {
          failed += hostStats.failures ?? hostStats.failed ?? 0;
        }
      }
      const finalStatus: AnsibleTaskRow["status"] = failed > 0 ? "failed" : "ok";
      setTasks((current) => completeRunning(current, finalStatus));
      if (stats) {
        setRecap(buildRecap(stats));
      }
      if (failed > 0) {
        setDone(true);
      }
    }
  }, []);

  return {
    tasks,
    recap,
    error,
    errorLogPath,
    done,
    onEvent,
    emitStep,
    reset,
    setDone,
    setError,
    setErrorLogPath,
  };
}
