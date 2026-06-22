import { useCallback, useRef, useState } from "react";
import type { AnsibleTaskRow } from "@turbopanel/components/ansible-task-list.tsx";
import { resolveServiceIdFromAnsibleName } from "../lib/ansible-service-map.ts";
import { CONSOLE_LAST_TASK_ERROR_LOG } from "../lib/paths.ts";
import {
  DEV_ENV_CONVERGE_STEP,
  installDevEnvironment,
} from "../lib/instance-install.ts";
import type { ConsoleLogLine } from "../lib/service-restart.ts";
import { writeTaskErrorLog } from "../lib/task-error-log.ts";
import { useAnsibleEvents } from "./use-ansible-events.ts";

export type DevEnvConvergeState = {
  active: boolean;
  tasks: AnsibleTaskRow[];
  recap: string | null;
  error: string | null;
  errorLogPath: string | null;
  installLogsByService: Record<string, ConsoleLogLine[]>;
  installingServiceIds: Record<string, true>;
};

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
  const [installLogsByService, setInstallLogsByService] = useState<
    Record<string, ConsoleLogLine[]>
  >({});
  const [installingServiceIds, setInstallingServiceIds] = useState<
    Record<string, true>
  >({});

  const resetConverge = useCallback(() => {
    reset();
    setInstallLogsByService({});
    setInstallingServiceIds({});
    currentServiceId.current = null;
  }, [reset]);

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
            setInstallingServiceIds((current) => {
              if (!current[previousServiceId]) {
                return current;
              }
              const next = { ...current };
              delete next[previousServiceId];
              return next;
            });
          }
          currentServiceId.current = resolved;
          if (resolved) {
            setInstallingServiceIds((current) =>
              current[resolved] ? current : { ...current, [resolved]: true },
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
            setInstallingServiceIds((current) =>
              current[resolved] ? current : { ...current, [resolved]: true },
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
            const line: ConsoleLogLine = {
              text: `${rawName} [${status}]`,
              time: new Date().toISOString(),
            };
            setInstallLogsByService((current) => ({
              ...current,
              [serviceId]: [...(current[serviceId] ?? []), line],
            }));
          }
        } else if (eventType === "v2_playbook_on_stats") {
          currentServiceId.current = null;
          setInstallingServiceIds({});
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
          title: "Start development environment",
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
        setInstallingServiceIds({});
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
    installLogsByService,
    installingServiceIds,
  };

  return { state, start, dismissError };
}
