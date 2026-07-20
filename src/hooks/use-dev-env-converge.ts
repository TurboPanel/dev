import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AnsibleTaskRow } from "@turbopanel/components/ansible-task-list.tsx";
import { resolveServiceIdFromAnsibleName } from "../lib/ansible-service-map.ts";
import { appendConvergeServiceLogLine } from "../lib/converge-service-log.ts";
import { CONSOLE_LAST_TASK_ERROR_LOG } from "../lib/paths.ts";
import {
  DEV_ENV_CONVERGE_STEP,
  installDevEnvironment,
} from "../lib/instance-install.ts";
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
    if (typeof event === "object" && event !== null) {
      const record = event as Record<string, unknown>;
      const eventType = record._event;
      if (typeof eventType === "string") {
        if (eventType === "v2_playbook_on_play_start") {
          const play = record.play as { name?: string } | undefined;
          const name = play?.name?.trim() ?? "";
          const resolved = name ? resolveServiceIdFromAnsibleName(name) : null;
          const previousServiceId = currentServiceId.current;
          if (previousServiceId && previousServiceId !== resolved) {
            markServiceReady(previousServiceId, setServicePhases);
          }
          currentServiceId.current = resolved;
          if (resolved) {
            markServicePhase(
              resolved,
              resolvePhaseFromAnsibleName(name),
              setServicePhases,
            );
          }
        } else if (
          eventType === "v2_playbook_on_task_start" ||
          eventType === "v2_runner_on_start"
        ) {
          const task = record.task as { name?: string } | undefined;
          const name = task?.name?.trim() ?? "";
          const resolved = name ? resolveServiceIdFromAnsibleName(name) : null;
          if (resolved) {
            currentServiceId.current = resolved;
            markServicePhase(
              resolved,
              resolvePhaseFromAnsibleName(name),
              setServicePhases,
            );
          }
        } else if (
          eventType === "v2_runner_on_ok" ||
          eventType === "v2_runner_on_failed" ||
          eventType === "v2_runner_on_skipped" ||
          eventType === "v2_runner_on_unreachable"
        ) {
          const serviceId = currentServiceId.current;
          if (serviceId) {
            const task = record.task as { name?: string } | undefined;
            const rawName = task?.name?.trim() || "task";
            const hosts = record.hosts as
              | Record<string, Record<string, unknown>>
              | undefined;
            const status = taskResultStatus(eventType, hosts);
            const time = new Date().toISOString();
            const text = `${rawName} [${status}]`;
            appendConvergeServiceLogLine(serviceId, text, time);
          }
        } else if (eventType === "v2_playbook_on_stats") {
          const finishingServiceId = currentServiceId.current;
          if (finishingServiceId) {
            markServiceReady(finishingServiceId, setServicePhases);
          }
          currentServiceId.current = null;
        }
      }
    }
    onEvent(event);
  }, [onEvent]);

  const start = useCallback(() => {
    if (running.current) {
      return;
    }
    running.current = true;
    setActive(true);
    resetConverge();

    void (async () => {
      const currentStep = DEV_ENV_CONVERGE_STEP;
      let success = true;
      try {
        await installDevEnvironment(onConvergeEvent, undefined, (label, status) => {
          emitStep(label, status);
        });
      } catch (caught) {
        success = false;
        emitStep(currentStep, "failed");
        const message = caught instanceof Error ? caught.message : String(caught);
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
        setActive(success ? false : true);
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
