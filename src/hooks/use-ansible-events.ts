import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { AnsibleTaskRow } from "@turbopanel/components/ansible-task-list.tsx";
import { parseDevConvergeSkippedEvent } from "../lib/dev-converge-skip-event.ts";
import { formatAnsibleHostFailure } from "../lib/ansible-failure.ts";
import {
  parseAnsibleJsonlRecord,
  type AnsibleJsonlRecord,
} from "../lib/ansible-jsonl.ts";
import { CONSOLE_LAST_TASK_ERROR_LOG } from "../lib/paths.ts";
import { writeTaskErrorLog } from "../lib/task-error-log.ts";

/**
 * Map a `dev_converge_skipped` JSONL event into the UI completion state.
 * Returns null for unrelated events so the normal Ansible handler continues.
 */
export function resolveDevConvergeSkippedUi(
  event: unknown,
): { recap: string; done: true } | null {
  const skippedReason = parseDevConvergeSkippedEvent(event);
  if (skippedReason === null) {
    return null;
  }
  return {
    recap: `Development environment already converged — ${skippedReason}`,
    done: true,
  };
}

function parseTaskName(full: string): { role: string | null; task: string } {
  const trimmed = full.trim();
  const colon = trimmed.indexOf(":");
  if (colon === -1) {
    return { role: null, task: trimmed };
  }

  const role = trimmed.slice(0, colon).trim();
  const task = trimmed.slice(colon + 1).trim();
  if (!role || !task) {
    return { role: null, task: trimmed };
  }

  return { role, task };
}

function taskLabel(full: string): string {
  const { role, task } = parseTaskName(full);
  return role ? `${role} › ${task}` : task;
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
    ? pinned.at(-1)!
    : tasks.length - 1;

  let start = Math.max(0, focusIndex - windowRows + 1);
  let end = start + windowRows;

  if (pinned.length > 0) {
    start = Math.min(start, pinned[0]!);
    end = Math.max(end, pinned.at(-1)! + 1);
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

export type AnsibleUiSetters = {
  setTasks: Dispatch<SetStateAction<AnsibleTaskRow[]>>;
  setRecap: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setErrorLogPath: Dispatch<SetStateAction<string | null>>;
  setDone: Dispatch<SetStateAction<boolean>>;
};

const TASK_START_EVENTS = new Set([
  "v2_playbook_on_task_start",
  "v2_playbook_on_handler_task_start",
  "v2_runner_on_start",
]);

const RUNNER_RESULT_EVENTS = new Set([
  "v2_runner_on_ok",
  "v2_runner_on_failed",
  "v2_runner_on_unreachable",
  "v2_runner_on_skipped",
]);

function closeRunningAtDepth(
  tasks: AnsibleTaskRow[],
  depth: number,
): AnsibleTaskRow[] {
  return tasks.map((task) => {
    if (task.depth === depth && task.status === "running") {
      return { ...task, status: "ok" as const };
    }
    return task;
  });
}

function playIdentity(record: AnsibleJsonlRecord): { playId: string; name: string } {
  const play = record.play as { name?: string; uuid?: string } | undefined;
  const name = play?.name?.trim() || "play";
  if (typeof play?.uuid === "string") {
    return { playId: `play:${play.uuid}`, name };
  }
  return { playId: `play:${name}`, name };
}

function taskIdentity(record: AnsibleJsonlRecord): { id: string; rawName: string } {
  const task = record.task as { id?: string; name?: string } | undefined;
  const rawName = task?.name ?? "task";
  if (typeof task?.id === "string") {
    return { id: `task:${task.id}`, rawName };
  }
  return { id: `task:${rawName}`, rawName };
}

function hostMap(
  record: AnsibleJsonlRecord,
): Record<string, Record<string, unknown>> | undefined {
  return record.hosts as Record<string, Record<string, unknown>> | undefined;
}

function upsertTaskStatus(
  setTasks: Dispatch<SetStateAction<AnsibleTaskRow[]>>,
  id: string,
  rawName: string,
  status: AnsibleTaskRow["status"],
) {
  setTasks((current) =>
    upsertTask(current, {
      id,
      label: taskLabel(rawName),
      status,
      depth: 2,
    })
  );
}

function applyPlayStart(
  record: AnsibleJsonlRecord,
  setTasks: Dispatch<SetStateAction<AnsibleTaskRow[]>>,
) {
  const { playId, name } = playIdentity(record);
  setTasks((current) =>
    upsertTask(closeRunningAtDepth(current, 1), {
      id: playId,
      label: name,
      status: "running",
      depth: 1,
    })
  );
}

function applyTaskStart(
  record: AnsibleJsonlRecord,
  setTasks: Dispatch<SetStateAction<AnsibleTaskRow[]>>,
) {
  const { id, rawName } = taskIdentity(record);
  upsertTaskStatus(setTasks, id, rawName, "running");
}

function runnerOkStatus(
  hosts: Record<string, Record<string, unknown>> | undefined,
): AnsibleTaskRow["status"] {
  if (!hosts) {
    return "ok";
  }
  const hostResult = Object.values(hosts)[0];
  if (hostResult?.changed === true) {
    return "changed";
  }
  return "ok";
}

function persistTaskFailure(
  message: string,
  setError: Dispatch<SetStateAction<string | null>>,
  setErrorLogPath: Dispatch<SetStateAction<string | null>>,
) {
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
}

function applyRunnerResult(
  record: AnsibleJsonlRecord,
  eventType: string,
  setters: AnsibleUiSetters,
) {
  const { id, rawName } = taskIdentity(record);
  const hosts = hostMap(record);
  if (eventType === "v2_runner_on_ok") {
    upsertTaskStatus(setters.setTasks, id, rawName, runnerOkStatus(hosts));
    return;
  }
  if (eventType === "v2_runner_on_skipped") {
    upsertTaskStatus(setters.setTasks, id, rawName, "skipped");
    return;
  }
  const message = hosts ? formatAnsibleHostFailure(hosts) : "task failed";
  upsertTaskStatus(setters.setTasks, id, rawName, "failed");
  persistTaskFailure(message, setters.setError, setters.setErrorLogPath);
}

function statsFailedCount(
  stats: Record<string, Record<string, number>> | undefined,
): number {
  if (!stats) {
    return 0;
  }
  let failed = 0;
  for (const hostStats of Object.values(stats)) {
    failed += hostStats.failures ?? hostStats.failed ?? 0;
  }
  return failed;
}

function applyPlayStats(record: AnsibleJsonlRecord, setters: AnsibleUiSetters) {
  const stats = record.stats as Record<string, Record<string, number>> | undefined;
  const failed = statsFailedCount(stats);
  if (failed > 0) {
    setters.setTasks((current) => completeRunning(current, "failed"));
    setters.setDone(true);
  } else {
    setters.setTasks((current) => completeRunning(current, "ok"));
  }
  if (stats) {
    setters.setRecap(buildRecap(stats));
  }
}

/** Apply a parsed Ansible JSONL event to the converge task UI setters. */
export function dispatchAnsibleUiEvent(
  eventType: string,
  record: AnsibleJsonlRecord,
  setters: AnsibleUiSetters,
): void {
  if (eventType === "v2_playbook_on_play_start") {
    applyPlayStart(record, setters.setTasks);
    return;
  }
  if (TASK_START_EVENTS.has(eventType)) {
    applyTaskStart(record, setters.setTasks);
    return;
  }
  if (RUNNER_RESULT_EVENTS.has(eventType)) {
    applyRunnerResult(record, eventType, setters);
    return;
  }
  if (eventType === "v2_playbook_on_stats") {
    applyPlayStats(record, setters);
  }
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
    const skipped = resolveDevConvergeSkippedUi(event);
    if (skipped !== null) {
      setRecap(skipped.recap);
      setDone(skipped.done);
      return;
    }

    const parsed = parseAnsibleJsonlRecord(event);
    if (parsed === null) {
      return;
    }
    dispatchAnsibleUiEvent(parsed.eventType, parsed.record, {
      setTasks,
      setRecap,
      setError,
      setErrorLogPath,
      setDone,
    });
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
