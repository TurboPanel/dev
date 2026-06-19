import { useEffect, useMemo, useState } from "react";
import { useApp, useInput } from "ink";
import {
  buildStatusSummary,
} from "@turbopanel/components/layout/status-bar.tsx";
import {
  followLogs,
  readBuildMode,
  startDevStack,
  switchBuildMode,
  ensureDevPlatformAccess,
} from "@turbopanel/lib/daemon-lifecycle.ts";
import {
  switchInstanceRuntime,
  readInstanceRuntime,
} from "@turbopanel/lib/instance-runtime.ts";
import { installDaemon } from "@turbopanel/lib/platform-install.ts";
import { resetDevEnvironment } from "@turbopanel/lib/reset-dev-environment.ts";
import { writeTaskErrorLog } from "@turbopanel/lib/task-error-log.ts";
import {
  CONSOLE_LAST_TASK_ERROR_LOG,
  checkPlatformRepos,
  denoRuntimeInstalled,
} from "@turbopanel/lib/paths.ts";
import {
  instanceReachable,
  instanceSocketPresent,
} from "@turbopanel/lib/stack-status.ts";
import { useAnsibleEvents } from "@turbopanel/hooks/use-ansible-events.ts";
import { useDeveloperState } from "@turbopanel/hooks/use-developer-state.ts";
import { useStackStatus } from "@turbopanel/hooks/use-stack-status.ts";
import { useTerminalLayout } from "@turbopanel/hooks/use-terminal-layout.ts";
import type { MainScreenArea } from "@turbopanel/screens/main-screen.tsx";

export const CONSOLE_AREAS: Array<{ id: MainScreenArea; label: string }> = [
  { id: "status", label: "Status" },
  { id: "instance", label: "Instance" },
  { id: "developer", label: "Developer" },
];

export type TaskHandlers = {
  onEvent: (event: unknown) => void;
  onStep: (
    label: string,
    status: "running" | "ok" | "failed",
    id?: string,
  ) => void;
};

export type TaskRunState = {
  title: string;
  action: (handlers: TaskHandlers) => Promise<void>;
};

export type ResetPromptState =
  | { step: "runtime" }
  | { step: "confirm"; target: "deno" | "workers" }
  | null;

/**
 * Console state, polling, keyboard routing, and action handlers.
 * Use from console.tsx while hand-building the UI; app-production.tsx
 * is the shipped layout that consumes the same hook.
 */
export function useConsole() {
  const { exit } = useApp();
  const [areaIndex, setAreaIndex] = useState(0);
  const [developerEditing, setDeveloperEditing] = useState(false);
  const [developerPanelFocused, setDeveloperPanelFocused] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [taskRun, setTaskRun] = useState<TaskRunState | null>(null);
  const [resetPrompt, setResetPrompt] = useState<ResetPromptState>(null);
  const [envRefresh, setEnvRefresh] = useState(0);
  const [platformDirectAccess, setPlatformDirectAccess] = useState(true);
  const ansible = useAnsibleEvents();

  const daemonStatus = useMemo(
    () => checkPlatformRepos()[0],
    [envRefresh],
  );
  const runtimeReady = useMemo(() => denoRuntimeInstalled(), [envRefresh]);
  const daemonPresent = daemonStatus.present;

  useEffect(() => {
    if (!daemonPresent) {
      return;
    }
    const turbopanelGroupExists = new Deno.Command("getent", {
      args: ["group", "turbopanel"],
      stdout: "null",
      stderr: "null",
    }).outputSync().success;
    if (!turbopanelGroupExists) {
      return;
    }
    void ensureDevPlatformAccess()
      .then(() => setPlatformDirectAccess(true))
      .catch(() => setPlatformDirectAccess(false));
  }, [daemonPresent]);

  const stackUnits = useStackStatus(daemonPresent);
  const instanceRuntime = useMemo(() => readInstanceRuntime(), [envRefresh]);
  const developerUnlocked = useMemo(() => {
    const caddy = stackUnits.find((unit) => unit.unit === "turbopanel-caddy");
    if (instanceRuntime === "workers") {
      return caddy?.active === true;
    }
    return instanceSocketPresent();
  }, [stackUnits, instanceRuntime]);
  const instanceApiReady = useMemo(() => {
    if (instanceRuntime === "workers") return instanceReachable();
    return instanceSocketPresent();
  }, [instanceRuntime]);
  const developerState = useDeveloperState(instanceApiReady);
  const buildMode = useMemo(
    () => (daemonPresent ? readBuildMode() : null),
    [daemonPresent, envRefresh],
  );
  const productionBuildActive = buildMode?.uiMode === "static" &&
    buildMode?.instanceRunMode === "compiled";

  const activeArea = CONSOLE_AREAS[areaIndex].id;
  const stackHealthy = stackUnits.every((unit) => unit.active === true);

  const menuItems = useMemo(() => {
    const items: Array<{ label: string; value: string }> = [
      { label: "Install/update daemon", value: "install" },
    ];

    if (daemonPresent) {
      items.push({ label: "Start dev stack", value: "start" });
      items.push({
        label: "Reset turbopanel development environment",
        value: "reset-dev",
      });
      items.push({ label: "Follow logs (fullscreen)", value: "logs" });

      if (instanceRuntime === "deno") {
        items.push({
          label: "Switch to Workers runtime",
          value: "runtime-workers",
        });
      } else {
        items.push({
          label: "Switch to Deno runtime",
          value: "runtime-deno",
        });
      }

      if (!productionBuildActive) {
        items.push({
          label: "Switch to production build",
          value: "build-production",
        });
      }

      if (productionBuildActive) {
        items.push({ label: "Switch to dev build", value: "build-dev" });
      }
    }

    items.push({ label: "Quit", value: "quit" });

    return items;
  }, [daemonPresent, productionBuildActive, instanceRuntime]);

  const inOverlay = taskRun !== null || resetPrompt !== null;
  const footerRows = showMenu && !inOverlay ? menuItems.length + 1 : 1;
  const { rows, columns, appHeight, mainHeight } = useTerminalLayout(footerRows);

  const statusSummary = buildStatusSummary({
    runtimeReady,
    daemonPresent,
    stackUnits,
    instanceRuntime,
    socketPresent: instanceSocketPresent(),
    developerState: instanceApiReady ? developerState : null,
  });

  const hints = inOverlay
    ? ""
    : developerUnlocked && activeArea === "developer"
    ? "↑↓ section · Enter focus · t target · m menu · q quit"
    : "← → area · m menu · q quit";

  useEffect(() => {
    if (!taskRun) return;

    ansible.reset();
    let cancelled = false;

    const persistFailure = async (message: string) => {
      ansible.setErrorLogPath(CONSOLE_LAST_TASK_ERROR_LOG);
      try {
        await writeTaskErrorLog({
          title: taskRun.title,
          message,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // Best-effort — UI still shows the inline error.
      }
    };

    const handlers: TaskHandlers = {
      onEvent: ansible.onEvent,
      onStep: (label, status, id) => {
        if (status === "failed") {
          ansible.emitStep(label, "failed", id);
          return;
        }
        ansible.emitStep(label, status, id);
      },
    };

    (async () => {
      try {
        await taskRun.action(handlers);
        if (!cancelled) {
          setEnvRefresh((value) => value + 1);
          ansible.setDone(true);
        }
      } catch (error) {
        if (!cancelled) {
          setEnvRefresh((value) => value + 1);
          const message = error instanceof Error ? error.message : String(error);
          ansible.setError((current) => current ?? message);
          await persistFailure(message);
          ansible.setDone(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [taskRun]);

  useInput((input, key) => {
    if (inOverlay) return;
    if (developerEditing) return;

    if (showMenu) {
      if (key.escape) setShowMenu(false);
      return;
    }

    if (key.escape && developerPanelFocused) return;

    if (input === "q" || key.escape) {
      exit();
      return;
    }

    if (input === "m") {
      setShowMenu(true);
      return;
    }

    if (developerPanelFocused) return;

    if (key.leftArrow) {
      setAreaIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (key.rightArrow) {
      setAreaIndex((i) => Math.min(CONSOLE_AREAS.length - 1, i + 1));
    }
  });

  const beginTaskRun = (title: string, action: TaskRunState["action"]) => {
    setShowMenu(false);
    setTaskRun({ title, action });
  };

  const handleMenuSelect = (item: { label: string; value: string }) => {
    setShowMenu(false);

    if (item.value === "quit") {
      exit();
      return;
    }

    if (item.value === "install") {
      beginTaskRun("Installing daemon…", async ({ onStep }) => {
        await installDaemon(onStep);
      });
      return;
    }

    if (item.value === "start") {
      beginTaskRun("Starting dev stack…", async (handlers) => {
        await startDevStack(handlers);
      });
      return;
    }

    if (item.value === "logs") {
      exit();
      queueMicrotask(async () => {
        try {
          await followLogs();
          Deno.exit(0);
        } catch (error) {
          console.error(error instanceof Error ? error.message : error);
          Deno.exit(1);
        }
      });
      return;
    }

    if (item.value === "runtime-workers") {
      beginTaskRun("Switching to Workers runtime…", async ({ onEvent }) => {
        await switchInstanceRuntime("workers", onEvent);
      });
      return;
    }

    if (item.value === "runtime-deno") {
      beginTaskRun("Switching to Deno runtime…", async ({ onEvent }) => {
        await switchInstanceRuntime("deno", onEvent);
      });
      return;
    }

    if (item.value === "build-production") {
      beginTaskRun("Switching to production build…", async ({ onEvent }) => {
        await switchBuildMode("production", onEvent);
      });
      return;
    }

    if (item.value === "build-dev") {
      beginTaskRun("Switching to dev build…", async ({ onEvent }) => {
        await switchBuildMode("dev", onEvent);
      });
      return;
    }

    if (item.value === "reset-dev") {
      setResetPrompt({ step: "runtime" });
    }
  };

  const handleInstanceSwitch = (target: "deno" | "workers") => {
    const title = target === "workers"
      ? "Switching to Workers runtime…"
      : "Switching to Deno runtime…";
    beginTaskRun(title, async ({ onEvent }) => {
      await switchInstanceRuntime(target, onEvent);
    });
  };

  return {
    exit,
    areaIndex,
    setAreaIndex,
    activeArea,
    developerEditing,
    setDeveloperEditing,
    developerPanelFocused,
    setDeveloperPanelFocused,
    showMenu,
    setShowMenu,
    taskRun,
    setTaskRun,
    resetPrompt,
    setResetPrompt,
    platformDirectAccess,
    ansible,
    daemonStatus,
    runtimeReady,
    daemonPresent,
    stackUnits,
    instanceRuntime,
    developerUnlocked,
    instanceApiReady,
    developerState,
    buildMode,
    productionBuildActive,
    stackHealthy,
    menuItems,
    inOverlay,
    footerRows,
    rows,
    columns,
    appHeight,
    mainHeight,
    statusSummary,
    hints,
    beginTaskRun,
    handleMenuSelect,
    handleInstanceSwitch,
  };
}
