import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { AnsibleTaskList } from "@turbopanel/components/ansible-task-list.tsx";
import {
  buildAnsibleTaskView,
  useAnsibleEvents,
} from "../hooks/use-ansible-events.ts";
import { useSpinnerFrame } from "../hooks/use-spinner-frame.ts";
import { installDaemon } from "../lib/platform-install.ts";
import { CONSOLE_LAST_TASK_ERROR_LOG } from "../lib/paths.ts";
import { appendOutputLines } from "../lib/install-output.ts";
import { logContentWidth } from "./log-scrollbar.tsx";
import { ScrollableLogList } from "./scrollable-log-list.tsx";
import { writeTaskErrorLog } from "../lib/task-error-log.ts";
import {
  bootstrapOrchestration,
  installDaemonSystemd,
} from "../lib/daemon-install.ts";
import { syncDevBuildToDaemons } from "../lib/daemon-actions.ts";
import {
  DEV_ENV_CONVERGE_STEP,
  installDevEnvironment,
} from "../lib/instance-install.ts";
import { resetDevEnvironment } from "../lib/reset-dev-environment.ts";
import { resetDevDatabase } from "../lib/reset-dev-database.ts";

const OUTPUT_LOG_ROWS = 6;
const SYNC_OUTPUT_LOG_ROWS = 200;

const BOOTSTRAP_UV = "Install uv package manager";
const BOOTSTRAP_PYTHON = "Install Python runtime";
const BOOTSTRAP_ANSIBLE = "Install Ansible tooling";
const BOOTSTRAP_CONVERGE = "Converge daemon stack (Ansible)";

function truncateLine(text: string, maxWidth: number): string {
  if (maxWidth < 4) return "…";
  if (text.length <= maxWidth) return text;
  return `${text.slice(0, maxWidth - 1)}…`;
}

type BootstrapPhase = "uv" | "python" | "ansible" | "converge";

/** Maps the in-flight bootstrap sub-phase to the task-list label it corresponds to. */
function bootstrapStepForPhase(phase: BootstrapPhase): string {
  switch (phase) {
    case "uv":
      return BOOTSTRAP_UV;
    case "python":
      return BOOTSTRAP_PYTHON;
    case "ansible":
      return BOOTSTRAP_ANSIBLE;
    case "converge":
      return BOOTSTRAP_CONVERGE;
  }
}
type ProvisionerPhase =
  | "daemon"
  | "dev-env"
  | "reset-dev-env"
  | "reset-dev-db"
  | "sync-dev-build";

export function ProvisionerPanel({
  width,
  height,
  phase = "daemon",
  onDone,
  onInstallFinished,
  onDaemonInstallDone,
}: {
  width: number;
  height: number;
  phase?: ProvisionerPhase;
  onDone: () => void;
  onInstallFinished?: (success: boolean) => void;
  onDaemonInstallDone?: () => void;
}) {
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const bootstrapPhase = useRef<BootstrapPhase>("uv");
  const {
    tasks,
    recap,
    error,
    errorLogPath,
    done,
    onEvent,
    emitStep,
    setDone,
    setError,
    setErrorLogPath,
  } = useAnsibleEvents();

  const isSyncPhase = phase === "sync-dev-build";
  const finished = done || error !== null;
  const footerRows = finished ? (error ? (errorLogPath ? 3 : 2) : 1) : 0;
  const showLiveSyncOutput = isSyncPhase && (!finished || outputLines.length > 0);
  const syncLogHeight = showLiveSyncOutput
    ? Math.max(6, Math.min(height - 10, Math.floor(height * 0.55)))
    : 0;
  const syncLogSectionRows = showLiveSyncOutput ? syncLogHeight + 2 : 0;
  const taskRowBudget = Math.max(
    3,
    height - 1 - footerRows - syncLogSectionRows,
  );
  const outputWidth = Math.max(20, width - 2);
  const syncLogContentWidth = logContentWidth(outputWidth, false);

  const appendOutput = useCallback((line: string) => {
    setOutputLines((lines) => appendOutputLines(lines, line, OUTPUT_LOG_ROWS));
  }, []);

  const appendSyncOutput = useCallback((line: string) => {
    setOutputLines((lines) => appendOutputLines(lines, line, SYNC_OUTPUT_LOG_ROWS));
  }, []);

  const trackBootstrapOutput = useCallback((line: string) => {
    appendOutput(line);
    const lower = line.toLowerCase();

    if (lower.includes("[orchestration] uv") || lower.includes("uv ")) {
      emitStep(BOOTSTRAP_UV, "running");
      bootstrapPhase.current = "uv";
    }
    if (lower.includes("ensuring python")) {
      emitStep(BOOTSTRAP_UV, "ok");
      emitStep(BOOTSTRAP_PYTHON, "running");
      bootstrapPhase.current = "python";
    }
    if (lower.includes("python") && lower.includes("ready")) {
      emitStep(BOOTSTRAP_PYTHON, "ok");
      emitStep(BOOTSTRAP_ANSIBLE, "running");
      bootstrapPhase.current = "ansible";
    }
    if (
      lower.includes("ansible")
      || lower.includes("galaxy")
      || lower.includes("virtualenv")
    ) {
      emitStep(BOOTSTRAP_ANSIBLE, "running");
      bootstrapPhase.current = "ansible";
    }
  }, [appendOutput, emitStep]);

  const trackBootstrapEvent = useCallback((event: unknown) => {
    onEvent(event);
    if (typeof event !== "object" || event === null) {
      return;
    }
    const record = event as Record<string, unknown>;
    const eventType = record._event;
    if (typeof eventType !== "string") {
      return;
    }

    if (eventType === "v2_playbook_on_play_start") {
      emitStep(BOOTSTRAP_ANSIBLE, "ok");
      emitStep(BOOTSTRAP_CONVERGE, "running");
      bootstrapPhase.current = "converge";
      return;
    }

    if (eventType === "v2_playbook_on_stats") {
      const stats = record.stats as Record<string, Record<string, number>> | undefined;
      let failed = 0;
      if (stats) {
        for (const hostStats of Object.values(stats)) {
          failed += hostStats.failures ?? hostStats.failed ?? 0;
        }
      }
      if (failed === 0) {
        emitStep(BOOTSTRAP_CONVERGE, "ok");
      }
    }
  }, [emitStep, onEvent]);

  const trackDevEnvStep = useCallback((
    label: string,
    status: "running" | "ok" | "failed",
  ) => {
    emitStep(label, status);
  }, [emitStep]);

  const view = useMemo(
    () => buildAnsibleTaskView(tasks, taskRowBudget),
    [tasks, taskRowBudget],
  );
  const hasRunningTask = tasks.some((task) => task.status === "running");
  const spinnerFrame = useSpinnerFrame(!finished && hasRunningTask ? 120 : 0);

  useEffect(() => {
    if (done) {
      onInstallFinished?.(true);
    }
  }, [done, onInstallFinished]);

  useEffect(() => {
    if (error !== null) {
      onInstallFinished?.(false);
    }
  }, [error, onInstallFinished]);

  useEffect(() => {
    if (phase !== "daemon") {
      return;
    }

    let cancelled = false;

    void (async () => {
      let currentStep = "Clone daemon repository";
      // True only while bootstrapOrchestration() is in flight: that single call covers
      // four displayed steps (uv/python/ansible/converge), so on failure we must consult
      // bootstrapPhase.current to find which of the four actually failed. Outside that
      // window, `currentStep` already names the real failing step (installDaemon and
      // installDaemonSystemd emit their own "failed" status before throwing) — without
      // this flag, a later failure (e.g. starting the systemd unit) would incorrectly
      // re-paint "Install uv package manager" as failed too, since currentStep was last
      // set there and never advanced past it.
      let duringBootstrapOrchestration = false;
      try {
        emitStep(currentStep, "running");
        await installDaemon(emitStep, appendOutput);
        if (cancelled) return;
        emitStep(currentStep, "ok");

        bootstrapPhase.current = "uv";
        currentStep = BOOTSTRAP_UV;
        emitStep(BOOTSTRAP_UV, "running");
        duringBootstrapOrchestration = true;
        await bootstrapOrchestration(trackBootstrapEvent, trackBootstrapOutput);
        duringBootstrapOrchestration = false;
        if (cancelled) return;
        emitStep(BOOTSTRAP_UV, "ok");
        emitStep(BOOTSTRAP_PYTHON, "ok");
        emitStep(BOOTSTRAP_ANSIBLE, "ok");
        emitStep(BOOTSTRAP_CONVERGE, "ok");

        currentStep = "Install turbopaneld systemd unit";
        await installDaemonSystemd(appendOutput, emitStep);
        if (cancelled) return;

        onInstallFinished?.(true);
        onDaemonInstallDone?.();
      } catch (caught) {
        if (cancelled) return;
        if (duringBootstrapOrchestration) {
          currentStep = bootstrapStepForPhase(bootstrapPhase.current);
        }
        emitStep(currentStep, "failed");
        const message = caught instanceof Error ? caught.message : String(caught);
        const saved = await writeTaskErrorLog({
          title: "Install daemon",
          message: `step=${currentStep}\n${message}`,
          tasks: [{ label: currentStep, status: "failed" }],
          timestamp: new Date().toISOString(),
        });
        if (saved) {
          setErrorLogPath(CONSOLE_LAST_TASK_ERROR_LOG);
        }
        setError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    appendOutput,
    emitStep,
    phase,
    setDone,
    setError,
    setErrorLogPath,
    trackBootstrapOutput,
  ]);

  useEffect(() => {
    if (phase !== "dev-env") {
      return;
    }

    let cancelled = false;

    void (async () => {
      const currentStep = DEV_ENV_CONVERGE_STEP;
      try {
        await installDevEnvironment(trackBootstrapEvent, appendOutput, trackDevEnvStep);
        if (cancelled) return;
        setDone(true);
      } catch (caught) {
        if (cancelled) return;
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
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    appendOutput,
    emitStep,
    phase,
    setDone,
    setError,
    setErrorLogPath,
    trackBootstrapEvent,
    trackDevEnvStep,
  ]);

  useEffect(() => {
    if (phase !== "reset-dev-env") {
      return;
    }

    let cancelled = false;

    void (async () => {
      const currentStep = DEV_ENV_CONVERGE_STEP;
      try {
        await resetDevEnvironment(appendOutput, trackDevEnvStep);
        if (cancelled) return;
        setDone(true);
      } catch (caught) {
        if (cancelled) return;
        emitStep(currentStep, "failed");
        const message = caught instanceof Error ? caught.message : String(caught);
        const saved = await writeTaskErrorLog({
          title: "Reset development environment",
          message: `step=${currentStep}\n${message}`,
          tasks: [{ label: currentStep, status: "failed" }],
          timestamp: new Date().toISOString(),
        });
        if (saved) {
          setErrorLogPath(CONSOLE_LAST_TASK_ERROR_LOG);
        }
        setError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    appendOutput,
    emitStep,
    phase,
    setDone,
    setError,
    setErrorLogPath,
    trackDevEnvStep,
  ]);

  useEffect(() => {
    if (phase !== "reset-dev-db") {
      return;
    }

    let cancelled = false;

    void (async () => {
      const stepLabel = "Reset dev database";
      try {
        emitStep(stepLabel, "running");
        await resetDevDatabase(appendOutput);
        if (cancelled) return;
        emitStep(stepLabel, "ok");
        setDone(true);
      } catch (caught) {
        if (cancelled) return;
        emitStep(stepLabel, "failed");
        const message = caught instanceof Error ? caught.message : String(caught);
        const saved = await writeTaskErrorLog({
          title: "Reset dev database",
          message: `step=${stepLabel}\n${message}`,
          tasks: [{ label: stepLabel, status: "failed" }],
          timestamp: new Date().toISOString(),
        });
        if (saved) {
          setErrorLogPath(CONSOLE_LAST_TASK_ERROR_LOG);
        }
        setError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    appendOutput,
    emitStep,
    phase,
    setDone,
    setError,
    setErrorLogPath,
  ]);

  useEffect(() => {
    if (phase !== "sync-dev-build") {
      return;
    }

    let cancelled = false;

    void (async () => {
      const stepLabel = "Sync dev build to attached daemons";
      try {
        emitStep(stepLabel, "running");
        await syncDevBuildToDaemons(appendSyncOutput);
        if (cancelled) return;
        emitStep(stepLabel, "ok");
        setDone(true);
      } catch (caught) {
        if (cancelled) return;
        emitStep(stepLabel, "failed");
        const message = caught instanceof Error ? caught.message : String(caught);
        const saved = await writeTaskErrorLog({
          title: "Sync dev build",
          message: `step=${stepLabel}\n${message}`,
          tasks: [{ label: stepLabel, status: "failed" }],
          timestamp: new Date().toISOString(),
        });
        if (saved) {
          setErrorLogPath(CONSOLE_LAST_TASK_ERROR_LOG);
        }
        setError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    appendSyncOutput,
    emitStep,
    phase,
    setDone,
    setError,
    setErrorLogPath,
  ]);

  useEffect(() => {
    if (done && error === null) {
      onDone();
    }
  }, [done, error, onDone]);

  useInput(() => {
    if (finished && error !== null) {
      onDone();
    }
  });

  const title = phase === "sync-dev-build"
    ? "Syncing dev build to attached daemons…"
    : phase === "dev-env"
      ? "Starting development environment"
      : phase === "reset-dev-env"
        ? "Resetting development environment…"
        : phase === "reset-dev-db"
          ? "Resetting dev database…"
          : "Bootstrapping development environment";

  const successMessage = phase === "sync-dev-build"
    ? "Dev build synced to attached daemons"
    : phase === "dev-env"
      ? "Development environment running"
      : phase === "reset-dev-env"
        ? "Development environment reset complete"
        : phase === "reset-dev-db"
          ? "Dev database reset complete"
          : "Development environment ready";

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1}>
      <Text color="cyan" bold>
        {title}
      </Text>
      <Box flexDirection="column" marginTop={1} flexGrow={1} minHeight={0}>
        <AnsibleTaskList
          visibleTasks={view.visibleTasks}
          hiddenCount={view.hiddenCount}
          followIndex={view.followIndex}
          height={taskRowBudget}
          recap={recap}
          error={error}
          errorLogPath={errorLogPath}
          columns={outputWidth}
          spinnerFrame={spinnerFrame}
        />
      </Box>
      {showLiveSyncOutput && (
        <Box flexDirection="column" marginTop={1} flexShrink={0} minHeight={0}>
          <Text dimColor>Output</Text>
          <ScrollableLogList
            width={outputWidth}
            height={syncLogHeight}
            selectedIndex={Math.max(0, outputLines.length - 1)}
            scrollAlignment="bottom"
          >
            {outputLines.map((line, index) => (
              <Text key={`${index}:${line}`} dimColor wrap="truncate">
                {truncateLine(line, syncLogContentWidth)}
              </Text>
            ))}
          </ScrollableLogList>
        </Box>
      )}
      {error && outputLines.length > 0 && !isSyncPhase && (
        <Box flexDirection="column" marginTop={1} flexShrink={0}>
          <Text dimColor>Output</Text>
          {outputLines.map((line, index) => (
            <Text key={`${index}:${line}`} dimColor wrap="truncate">
              {truncateLine(line, outputWidth)}
            </Text>
          ))}
        </Box>
      )}
      {finished && !error && (
        <Box marginTop={1}>
          <Text color="green">{successMessage}</Text>
        </Box>
      )}
      {finished && error !== null && (
        <Box marginTop={1}>
          <Text dimColor>Press any key to continue</Text>
        </Box>
      )}
    </Box>
  );
}
