import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { AnsibleTaskList } from "@turbopanel/components/ansible-task-list.tsx";
import {
  buildAnsibleTaskView,
  useAnsibleEvents,
} from "../hooks/use-ansible-events.ts";
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
import { buildDaemonBinaries } from "../lib/daemon-actions.ts";
import {
  DEV_ENV_CONVERGE_STEP,
  installDevEnvironment,
} from "../lib/instance-install.ts";

const OUTPUT_LOG_ROWS = 6;
const BUILD_OUTPUT_LOG_ROWS = 200;

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
type ProvisionerPhase = "daemon" | "dev-env" | "build-daemon-binaries";

export function ProvisionerPanel({
  width,
  height,
  phase = "daemon",
  onDone,
  onInstallFinished,
}: {
  width: number;
  height: number;
  phase?: ProvisionerPhase;
  onDone: () => void;
  onInstallFinished?: (success: boolean) => void;
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

  const isBuildPhase = phase === "build-daemon-binaries";
  const finished = done || error !== null;
  const footerRows = finished ? (error ? (errorLogPath ? 3 : 2) : 1) : 0;
  const showLiveBuildOutput = isBuildPhase && (!finished || outputLines.length > 0);
  const buildLogHeight = showLiveBuildOutput
    ? Math.max(6, Math.min(height - 10, Math.floor(height * 0.55)))
    : 0;
  const buildLogSectionRows = showLiveBuildOutput ? buildLogHeight + 2 : 0;
  const taskRowBudget = Math.max(
    3,
    height - 1 - footerRows - buildLogSectionRows,
  );
  const outputWidth = Math.max(20, width);
  const buildLogContentWidth = logContentWidth(outputWidth, false);

  const appendOutput = useCallback((line: string) => {
    setOutputLines((lines) => appendOutputLines(lines, line, OUTPUT_LOG_ROWS));
  }, []);

  const appendBuildOutput = useCallback((line: string) => {
    setOutputLines((lines) => appendOutputLines(lines, line, BUILD_OUTPUT_LOG_ROWS));
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
      try {
        emitStep(currentStep, "running");
        await installDaemon(emitStep, appendOutput);
        if (cancelled) return;
        emitStep(currentStep, "ok");

        bootstrapPhase.current = "uv";
        currentStep = BOOTSTRAP_UV;
        emitStep(BOOTSTRAP_UV, "running");
        await bootstrapOrchestration(trackBootstrapEvent, trackBootstrapOutput);
        if (cancelled) return;
        emitStep(BOOTSTRAP_UV, "ok");
        emitStep(BOOTSTRAP_PYTHON, "ok");
        emitStep(BOOTSTRAP_ANSIBLE, "ok");
        emitStep(BOOTSTRAP_CONVERGE, "ok");

        await installDaemonSystemd(appendOutput, emitStep);
        if (cancelled) return;

        currentStep = DEV_ENV_CONVERGE_STEP;
        await installDevEnvironment(trackBootstrapEvent, appendOutput, trackDevEnvStep);
        if (cancelled) return;

        setDone(true);
      } catch (caught) {
        if (cancelled) return;
        emitStep(currentStep, "failed");
        if (bootstrapPhase.current === "uv") {
          emitStep(BOOTSTRAP_UV, "failed");
        } else if (bootstrapPhase.current === "python") {
          emitStep(BOOTSTRAP_PYTHON, "failed");
        } else if (bootstrapPhase.current === "ansible") {
          emitStep(BOOTSTRAP_ANSIBLE, "failed");
        } else {
          emitStep(BOOTSTRAP_CONVERGE, "failed");
        }
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
    trackBootstrapEvent,
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
    if (phase !== "build-daemon-binaries") {
      return;
    }

    let cancelled = false;

    void (async () => {
      const stepLabel = "Build daemon binaries (amd64 + arm64)";
      try {
        emitStep(stepLabel, "running");
        await buildDaemonBinaries(appendBuildOutput);
        if (cancelled) return;
        emitStep(stepLabel, "ok");
        setDone(true);
      } catch (caught) {
        if (cancelled) return;
        emitStep(stepLabel, "failed");
        const message = caught instanceof Error ? caught.message : String(caught);
        const saved = await writeTaskErrorLog({
          title: "Build daemon binaries",
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
    appendBuildOutput,
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

  const title = phase === "build-daemon-binaries"
    ? "Building daemon binaries…"
    : phase === "dev-env"
      ? "Starting development environment"
      : "Bootstrapping development environment";

  const successMessage = phase === "build-daemon-binaries"
    ? "Daemon binaries built successfully"
    : phase === "dev-env"
      ? "Development environment running"
      : "Development environment ready";

  return (
    <Box flexDirection="column" width={width} height={height}>
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
        />
      </Box>
      {showLiveBuildOutput && (
        <Box flexDirection="column" marginTop={1} flexShrink={0} minHeight={0}>
          <Text dimColor>Output</Text>
          <ScrollableLogList
            width={outputWidth}
            height={buildLogHeight}
            selectedIndex={Math.max(0, outputLines.length - 1)}
            scrollAlignment="bottom"
          >
            {outputLines.map((line, index) => (
              <Text key={`${index}:${line}`} dimColor wrap="truncate">
                {truncateLine(line, buildLogContentWidth)}
              </Text>
            ))}
          </ScrollableLogList>
        </Box>
      )}
      {error && outputLines.length > 0 && !isBuildPhase && (
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
