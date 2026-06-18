import { useCallback, useState } from "react";
import type { AnsibleTaskRow } from "@turbopanel/components/ansible-task-list.tsx";

function stripRolePrefix(name: string): string {
  const match = name.match(/^\s*[^:]+:\s*(.+)$/);
  return match ? match[1].trim() : name.trim();
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

export function useAnsibleEvents() {
  const [tasks, setTasks] = useState<AnsibleTaskRow[]>([]);
  const [recap, setRecap] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = useCallback(() => {
    setTasks([]);
    setRecap(null);
    setError(null);
    setDone(false);
  }, []);

  const emitStep = useCallback((
    label: string,
    status: AnsibleTaskRow["status"],
    id?: string,
  ) => {
    const stepId = id ?? `step:${label}`;
    setTasks((current) => upsertTask(current, { id: stepId, label, status }));
  }, []);

  const onEvent = useCallback((event: unknown) => {
    if (typeof event !== "object" || event === null) return;
    const record = event as Record<string, unknown>;
    const eventType = record._event;
    if (typeof eventType !== "string") return;

    if (
      eventType === "v2_playbook_on_task_start" ||
      eventType === "v2_playbook_on_handler_task_start" ||
      eventType === "v2_runner_on_start"
    ) {
      const task = record.task as { id?: string; name?: string } | undefined;
      const name = stripRolePrefix(task?.name ?? "task");
      const id = typeof task?.id === "string" ? task.id : name;
      setTasks((current) =>
        upsertTask(current, { id, label: name, status: "running" })
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
      const name = stripRolePrefix(task?.name ?? "task");
      const id = typeof task?.id === "string" ? task.id : name;
      const hosts = record.hosts as
        | Record<string, Record<string, unknown>>
        | undefined;

      if (eventType === "v2_runner_on_ok") {
        const hostResult = hosts ? Object.values(hosts)[0] : undefined;
        const changed = hostResult?.changed === true;
        setTasks((current) =>
          upsertTask(current, {
            id,
            label: name,
            status: changed ? "changed" : "ok",
          })
        );
        return;
      }

      if (eventType === "v2_runner_on_skipped") {
        setTasks((current) =>
          upsertTask(current, { id, label: name, status: "skipped" })
        );
        return;
      }

      const message = hosts ? hostMessages(hosts) : "task failed";
      setTasks((current) =>
        upsertTask(current, { id, label: name, status: "failed" })
      );
      setError(message);
      return;
    }

    if (eventType === "v2_playbook_on_stats") {
      const stats = record.stats as
        | Record<string, Record<string, number>>
        | undefined;
      if (stats) {
        setRecap(buildRecap(stats));
      }
    }
  }, []);

  return {
    tasks,
    recap,
    error,
    done,
    onEvent,
    emitStep,
    reset,
    setDone,
    setError,
  };
}
