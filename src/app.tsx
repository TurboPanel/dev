import React, { useMemo, useState } from "react";
import {
  Box,
  Text,
  useApp,
  useInput,
  useTerminalSize,
} from "@deno-ink/core";
import { ActionMenu } from "@turbopanel/action-menu";
import { buildCompactHeader } from "@turbopanel/compact-header";
import { DeveloperPanels } from "@turbopanel/developer-console";
import {
  followLogs,
  readBuildMode,
  startDevStack,
  switchBuildMode,
} from "@turbopanel/daemon-lifecycle";
import { switchInstanceRuntime, readInstanceRuntime } from "@turbopanel/instance-runtime";
import { installDaemon } from "@turbopanel/platform-install";
import { resetDevEnvironment } from "@turbopanel/reset-dev-environment";
import {
  checkPlatformRepos,
  denoRuntimeInstalled,
} from "@turbopanel/paths";
import {
  instanceReachable,
  instanceSocketPresent,
} from "@turbopanel/stack-status";
import { useDeveloperState } from "@turbopanel/use-developer-state";
import { useStackStatus } from "@turbopanel/use-stack-status";

async function runAfterExit(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    Deno.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}

export function App() {
  const { exit } = useApp();
  const { rows, columns } = useTerminalSize(250);
  const [developerEditing, setDeveloperEditing] = useState(false);
  const [developerPanelFocused, setDeveloperPanelFocused] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const daemonStatus = useMemo(() => checkPlatformRepos()[0], []);
  const runtimeReady = denoRuntimeInstalled();
  const daemonPresent = daemonStatus.present;
  const stackUnits = useStackStatus(daemonPresent);
  const instanceRuntime = useMemo(() => readInstanceRuntime(), []);
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
  }, [stackUnits, instanceRuntime]);
  const developerState = useDeveloperState(instanceApiReady);
  const buildMode = useMemo(
    () => (daemonPresent ? readBuildMode() : null),
    [daemonPresent],
  );
  const productionBuildActive = buildMode?.uiMode === "static" &&
    buildMode?.instanceRunMode === "compiled";

  const headerLine = buildCompactHeader({
    runtimeReady,
    daemonPresent,
    stackUnits,
    instanceRuntime,
    socketPresent: instanceSocketPresent(),
    developerState: instanceApiReady ? developerState : null,
  });

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

  const footerRows = showMenu ? menuItems.length + 1 : 1;
  const mainHeight = Math.max(1, rows - 1 - footerRows);

  useInput((input, key) => {
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
    }
  });

  const handleSelect = (item: { label: string; value: string }) => {
    setShowMenu(false);

    if (item.value === "quit") {
      exit();
      return;
    }

    if (item.value === "install") {
      exit();
      queueMicrotask(() => runAfterExit(installDaemon));
      return;
    }

    if (item.value === "start") {
      exit();
      queueMicrotask(() => runAfterExit(startDevStack));
      return;
    }

    if (item.value === "logs") {
      exit();
      queueMicrotask(() => runAfterExit(followLogs));
      return;
    }

    if (item.value === "runtime-workers") {
      exit();
      queueMicrotask(() => runAfterExit(() => switchInstanceRuntime("workers")));
      return;
    }

    if (item.value === "runtime-deno") {
      exit();
      queueMicrotask(() => runAfterExit(() => switchInstanceRuntime("deno")));
      return;
    }

    if (item.value === "build-production") {
      exit();
      queueMicrotask(() => runAfterExit(() => switchBuildMode("production")));
      return;
    }

    if (item.value === "build-dev") {
      exit();
      queueMicrotask(() => runAfterExit(() => switchBuildMode("dev")));
      return;
    }

    if (item.value === "reset-dev") {
      exit();
      queueMicrotask(() => runAfterExit(resetDevEnvironment));
    }
  };

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      <Box flexShrink={0} paddingX={1}>
        <Text wrap="truncate">{headerLine}</Text>
      </Box>

      <Box
        flexDirection="column"
        flexGrow={1}
        height={mainHeight}
        paddingX={1}
      >
        {!daemonPresent ? (
          <Text dimColor>
            Daemon not installed — press m for menu, then Install/update daemon
          </Text>
        ) : developerUnlocked ? (
          developerState.healthOk === null && !developerState.error ? (
            <Text dimColor>Connecting to instance API…</Text>
          ) : (
            <DeveloperPanels
              contentHeight={mainHeight}
              state={developerState}
              onEditingChange={setDeveloperEditing}
              onPanelFocusChange={setDeveloperPanelFocused}
            />
          )
        ) : (
          <Text dimColor>
            Waiting for instance — stack units above show progress; m menu to
            start dev stack
          </Text>
        )}
      </Box>

      {showMenu ? (
        <Box flexShrink={0} paddingX={1} flexDirection="column">
          <Text dimColor>Actions · ↑↓ select · Enter run · Esc cancel</Text>
          <ActionMenu items={menuItems} onSelect={handleSelect} />
        </Box>
      ) : (
        <Box flexShrink={0} paddingX={1}>
          <Text dimColor>
            {developerUnlocked
              ? "↑↓ section · Enter focus · t target · m menu · q quit"
              : "m menu · q quit"}
          </Text>
        </Box>
      )}
    </Box>
  );
}
