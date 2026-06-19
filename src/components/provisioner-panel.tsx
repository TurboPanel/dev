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
import { writeTaskErrorLog } from "../lib/task-error-log.ts";
import {
  bootstrapOrchestration,
  installDaemonSystemd,
} from "../lib/daemon-install.ts";

const OUTPUT_LOG_ROWS = 6;

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

export function ProvisionerPanel({
  width,
  height,
  onDone,
  onInstallFinished,
}: {
  width: number;
  height: number;
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

  const finished = done || error !== null;
  const footerRows = finished ? (error ? (errorLogPath ? 3 : 2) : 1) : 0;
  const taskRowBudget = Math.max(6, height - 1 - footerRows);
  const outputWidth = Math.max(20, width);

  const appendOutput = useCallback((line: string) => {
    setOutputLines((lines) => appendOutputLines(lines, line, OUTPUT_LOG_ROWS));
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
    let cancelled = false;

    void (async () => {
      let currentStep = "Clone daemon repository";
      try {
        emitStep(currentStep, "running");
        await installDaemon(emitStep, appendOutput);
        if (cancelled) return;
        emitStep(currentStep, "ok");

        bootstrapPhase.current = "uv";
        emitStep(BOOTSTRAP_UV, "running");
        await bootstrapOrchestration(trackBootstrapEvent, trackBootstrapOutput);
        if (cancelled) return;
        emitStep(BOOTSTRAP_UV, "ok");
        emitStep(BOOTSTRAP_PYTHON, "ok");
        emitStep(BOOTSTRAP_ANSIBLE, "ok");
        emitStep(BOOTSTRAP_CONVERGE, "ok");

        await installDaemonSystemd(appendOutput, emitStep);
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
    setDone,
    setError,
    setErrorLogPath,
    trackBootstrapEvent,
    trackBootstrapOutput,
  ]);

  useInput(() => {
    if (finished) {
      onDone();
    }
  });

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text color="cyan" bold>
        Provisioning development environment
      </Text>
      <Box flexDirection="column" marginTop={1} flexGrow={1} minHeight={0}>
        <AnsibleTaskList
          steps={view.steps}
          activePlay={view.activePlay}
          recentTasks={view.recentTasks}
          hiddenTaskCount={view.hiddenTaskCount}
          recap={recap}
          error={error}
          errorLogPath={errorLogPath}
          columns={outputWidth}
        />
      </Box>
      {error && outputLines.length > 0 && (
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
          <Text color="green">Daemon installed and running</Text>
        </Box>
      )}
      {finished && (
        <Box marginTop={1}>
          <Text dimColor>Press any key to continue</Text>
        </Box>
      )}
    </Box>
  );
}
