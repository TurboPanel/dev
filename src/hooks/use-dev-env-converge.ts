import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AnsibleTaskRow } from "@turbopanel/components/ansible-task-list.tsx";
import {
  parseAnsibleJsonlRecord,
  type AnsibleJsonlRecord,
} from "../lib/ansible-jsonl.ts";
import { resolveServiceIdFromAnsibleName } from "../lib/ansible-service-map.ts";
import { appendConvergeServiceLogLine } from "../lib/converge-service-log.ts";
import { CONSOLE_LAST_TASK_ERROR_LOG } from "../lib/paths.ts";
import {
  DEV_ENV_CONVERGE_STEP,
  installDevEnvironment,
} from "../lib/instance-install.ts";
import {
  applyOptionalDevServices,
  type OptionalDevServiceSelection,
  readOptionalDevServices,
  writeOptionalDevServices,
} from "../lib/optional-dev-services.ts";
import { writeTaskErrorLog } from "../lib/task-error-log.ts";
import { useAnsibleEvents } from "./use-ansible-events.ts";

export type ConvergeServicePhase = "installing" | "compiling" | "ready";

export type DevEnvConvergeState = {
  active: boolean;
  tasks: AnsibleTaskRow[];
  recap: string | null;
  error: string | null;
  errorLogPath: string | null;
  servicePhases: Record<string, ConvergeServicePhase>;
};

function resolvePhaseFromAnsibleName(name: string): ConvergeServicePhase {
  const lower = name.toLowerCase();
  if (lower.includes("-build") || lower.includes("compile")) {
    return "compiling";
  }
  return "installing";
}

function taskResultStatus(
  eventType: string,
  hosts: Record<string, Record<string, unknown>> | undefined,
): string {
  if (eventType === "v2_runner_on_ok") {
    const hostResult = hosts ? Object.values(hosts)[0] : undefined;
    return hostResult?.changed === true ? "changed" : "ok";
  }
  if (eventType === "v2_runner_on_skipped") {
    return "skipped";
  }
  if (eventType === "v2_runner_on_unreachable") {
    return "unreachable";
  }
  return "failed";
}

function markServiceReady(
  serviceId: string,
  setServicePhases: Dispatch<SetStateAction<Record<string, ConvergeServicePhase>>>,
) {
  setServicePhases((current) => {
    if (current[serviceId] === "ready") {
      return current;
    }
    return { ...current, [serviceId]: "ready" };
  });
}

function markServicePhase(
  serviceId: string,
  phase: ConvergeServicePhase,
  setServicePhases: Dispatch<SetStateAction<Record<string, ConvergeServicePhase>>>,
) {
  setServicePhases((current) =>
    current[serviceId] === phase ? current : { ...current, [serviceId]: phase },
  );
}

const CONVERGE_TASK_START_EVENTS = new Set([
  "v2_playbook_on_task_start",
  "v2_runner_on_start",
]);

const CONVERGE_RUNNER_RESULT_EVENTS = new Set([
  "v2_runner_on_ok",
  "v2_runner_on_failed",
  "v2_runner_on_skipped",
  "v2_runner_on_unreachable",
]);

function serviceIdFromName(name: string): string | null {
  if (!name) {
    return null;
  }
  return resolveServiceIdFromAnsibleName(name);
}

function playName(record: AnsibleJsonlRecord): string {
  const play = record.play as { name?: string } | undefined;
  return play?.name?.trim() ?? "";
}

function taskName(record: AnsibleJsonlRecord): string {
  const task = record.task as { name?: string } | undefined;
  return task?.name?.trim() ?? "";
}

function applyPlayStartTracking(
  record: AnsibleJsonlRecord,
  currentServiceId: { current: string | null },
  setServicePhases: Dispatch<SetStateAction<Record<string, ConvergeServicePhase>>>,
) {
  const name = playName(record);
  const resolved = serviceIdFromName(name);
  const previousServiceId = currentServiceId.current;
  if (previousServiceId && previousServiceId !== resolved) {
    markServiceReady(previousServiceId, setServicePhases);
  }
  currentServiceId.current = resolved;
  if (!resolved) {
    return;
  }
  markServicePhase(resolved, resolvePhaseFromAnsibleName(name), setServicePhases);
}

function applyTaskStartTracking(
  record: AnsibleJsonlRecord,
  currentServiceId: { current: string | null },
  setServicePhases: Dispatch<SetStateAction<Record<string, ConvergeServicePhase>>>,
) {
  const name = taskName(record);
  const resolved = serviceIdFromName(name);
  if (!resolved) {
    return;
  }
  currentServiceId.current = resolved;
  markServicePhase(resolved, resolvePhaseFromAnsibleName(name), setServicePhases);
}

function applyRunnerLogTracking(
  record: AnsibleJsonlRecord,
  eventType: string,
  currentServiceId: { current: string | null },
) {
  const serviceId = currentServiceId.current;
  if (!serviceId) {
    return;
  }
  const rawName = taskName(record) || "task";
  const hosts = record.hosts as Record<string, Record<string, unknown>> | undefined;
  const status = taskResultStatus(eventType, hosts);
  appendConvergeServiceLogLine(
    serviceId,
    `${rawName} [${status}]`,
    new Date().toISOString(),
  );
}

function applyStatsTracking(
  currentServiceId: { current: string | null },
  setServicePhases: Dispatch<SetStateAction<Record<string, ConvergeServicePhase>>>,
) {
  const finishingServiceId = currentServiceId.current;
  if (finishingServiceId) {
    markServiceReady(finishingServiceId, setServicePhases);
  }
  currentServiceId.current = null;
}

/** Advance per-service converge phases / logs from a JSONL Ansible event. */
export function trackConvergeServiceEvent(
  event: unknown,
  currentServiceId: { current: string | null },
  setServicePhases: Dispatch<SetStateAction<Record<string, ConvergeServicePhase>>>,
): void {
  const parsed = parseAnsibleJsonlRecord(event);
  if (parsed === null) {
    return;
  }
  const { record, eventType } = parsed;
  if (eventType === "v2_playbook_on_play_start") {
    applyPlayStartTracking(record, currentServiceId, setServicePhases);
    return;
  }
  if (CONVERGE_TASK_START_EVENTS.has(eventType)) {
    applyTaskStartTracking(record, currentServiceId, setServicePhases);
    return;
  }
  if (CONVERGE_RUNNER_RESULT_EVENTS.has(eventType)) {
    applyRunnerLogTracking(record, eventType, currentServiceId);
    return;
  }
  if (eventType === "v2_playbook_on_stats") {
    applyStatsTracking(currentServiceId, setServicePhases);
  }
}

export function useDevEnvConverge(onFinished: (success: boolean) => void) {
  const {
    tasks,
    recap,
    error,
    errorLogPath,
    onEvent,
    emitStep,
    reset,
    setError,
    setErrorLogPath,
  } = useAnsibleEvents();
  const running = useRef(false);
  const currentServiceId = useRef<string | null>(null);
  const [active, setActive] = useState(false);
  const [servicePhases, setServicePhases] = useState<
    Record<string, ConvergeServicePhase>
  >({});

  const resetConverge = useCallback(() => {
    reset();
    setServicePhases({});
    currentServiceId.current = null;
  }, [reset]);

  // Event wiring: installDevEnvironment → runOrchestrationAction →
  // run-orchestration-action.ts → runInstanceDevInstall() → runLocalPlaybook(onEvent) →
  // runPlaybookStreaming (JSONL) → onConvergeEvent (here) → useAnsibleEvents.onEvent →
  // React state → AnsibleTaskList.
  const onConvergeEvent = useCallback((event: unknown) => {
    trackConvergeServiceEvent(event, currentServiceId, setServicePhases);
    onEvent(event);
  }, [onEvent]);

  const start = useCallback((
    mode: "if-needed" | "force",
    optionalServices?: OptionalDevServiceSelection,
  ) => {
    if (running.current) {
      return;
    }
    running.current = true;
    setActive(true);
    resetConverge();

    const selection = optionalServices ?? readOptionalDevServices();
    writeOptionalDevServices(selection);

    void (async () => {
      const currentStep = DEV_ENV_CONVERGE_STEP;
      let success = true;
      try {
        await installDevEnvironment(
          onConvergeEvent,
          undefined,
          (label, status) => {
            emitStep(label, status);
          },
          undefined,
          mode,
          selection,
        );
        // Belt-and-suspenders: Ansible should honor optional flags, but apply
        // again so a stale enabled unit from a prior converge stays off.
        await applyOptionalDevServices(selection);
      } catch (error_) {
        success = false;
        emitStep(currentStep, "failed");
        const message = error_ instanceof Error ? error_.message : String(error_);
        const saved = await writeTaskErrorLog({
          title: "Converge / re-converge development environment",
          message: `step=${currentStep}\n${message}`,
          tasks: [{ label: currentStep, status: "failed" }],
          timestamp: new Date().toISOString(),
        });
        if (saved) {
          setErrorLogPath(CONSOLE_LAST_TASK_ERROR_LOG);
        }
        setError(message);
      } finally {
        running.current = false;
        setServicePhases((current) => {
          const next: Record<string, ConvergeServicePhase> = {};
          for (const serviceId of Object.keys(current)) {
            next[serviceId] = "ready";
          }
          return next;
        });
        setActive(!success);
        onFinished(success);
      }
    })();
  }, [
    emitStep,
    onConvergeEvent,
    onFinished,
    resetConverge,
    setError,
    setErrorLogPath,
  ]);

  const dismissError = useCallback(() => {
    setActive(false);
    resetConverge();
  }, [resetConverge]);

  const state: DevEnvConvergeState = {
    active: active || running.current,
    tasks,
    recap,
    error,
    errorLogPath,
    servicePhases,
  };

  return { state, start, dismissError };
}
