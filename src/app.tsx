import React, { useMemo, useState } from "react";
import {
  useApp,
  useInput,
} from "@deno-ink/core";
import { AppShell } from "@turbopanel/components/layout/app-shell.tsx";
import { MenuBar } from "@turbopanel/components/layout/menu-bar.tsx";
import {
  buildStatusSummary,
  StatusBar,
} from "@turbopanel/components/layout/status-bar.tsx";
import {
  followLogs,
  readBuildMode,
  startDevStack,
  switchBuildMode,
} from "@turbopanel/lib/daemon-lifecycle.ts";
import {
  switchInstanceRuntime,
  readInstanceRuntime,
} from "@turbopanel/lib/instance-runtime.ts";
import { installDaemon } from "@turbopanel/lib/platform-install.ts";
import { resetDevEnvironment } from "@turbopanel/lib/reset-dev-environment.ts";
import {
  checkPlatformRepos,
  denoRuntimeInstalled,
} from "@turbopanel/lib/paths.ts";
import {
  instanceReachable,
  instanceSocketPresent,
} from "@turbopanel/lib/stack-status.ts";
import { useDeveloperState } from "@turbopanel/hooks/use-developer-state.ts";
import { useStackStatus } from "@turbopanel/hooks/use-stack-status.ts";
import { useTerminalLayout } from "@turbopanel/hooks/use-terminal-layout.ts";
import {
  MainScreen,
  type MainScreenArea,
} from "@turbopanel/screens/main-screen.tsx";

async function runAfterExit(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    Deno.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}

const AREAS: Array<{ id: MainScreenArea; label: string }> = [
  { id: "status", label: "Status" },
  { id: "instance", label: "Instance" },
  { id: "developer", label: "Developer" },
];

export function App() {
  const { exit } = useApp();
  const [areaIndex, setAreaIndex] = useState(0);
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
  }, [instanceRuntime]);
  const developerState = useDeveloperState(instanceApiReady);
  const buildMode = useMemo(
    () => (daemonPresent ? readBuildMode() : null),
    [daemonPresent],
  );
  const productionBuildActive = buildMode?.uiMode === "static" &&
    buildMode?.instanceRunMode === "compiled";

  const activeArea = AREAS[areaIndex].id;
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

  const footerRows = showMenu ? menuItems.length + 1 : 1;
  const { rows, columns, appHeight, mainHeight } = useTerminalLayout(footerRows);

  const statusSummary = buildStatusSummary({
    runtimeReady,
    daemonPresent,
    stackUnits,
    instanceRuntime,
    socketPresent: instanceSocketPresent(),
    developerState: instanceApiReady ? developerState : null,
  });

  const hints = developerUnlocked && activeArea === "developer"
    ? "↑↓ section · Enter focus · t target · m menu · q quit"
    : "← → area · m menu · q quit";

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
      return;
    }

    if (developerPanelFocused) return;

    if (key.leftArrow) {
      setAreaIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (key.rightArrow) {
      setAreaIndex((i) => Math.min(AREAS.length - 1, i + 1));
    }
  });

  const handleMenuSelect = (item: { label: string; value: string }) => {
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

  const handleInstanceSwitch = (target: "deno" | "workers") => {
    exit();
    queueMicrotask(() => runAfterExit(() => switchInstanceRuntime(target)));
  };

  return (
    <AppShell
      height={appHeight}
      columns={columns}
      menuBar={
        <MenuBar
          areas={AREAS}
          activeIndex={areaIndex}
          instanceRuntime={instanceRuntime}
        />
      }
      main={
        <MainScreen
          area={activeArea}
          mainHeight={mainHeight}
          runtimeReady={runtimeReady}
          daemonStatus={daemonStatus}
          daemonPresent={daemonPresent}
          platformDirectAccess={false}
          stackUnits={stackUnits}
          developerUnlocked={developerUnlocked}
          stackHealthy={stackHealthy}
          developerState={developerState}
          onInstanceSwitch={handleInstanceSwitch}
          onDeveloperEditingChange={setDeveloperEditing}
          onDeveloperPanelFocusChange={setDeveloperPanelFocused}
        />
      }
      statusBar={
        <StatusBar
          showMenu={showMenu}
          menuItems={menuItems}
          onMenuSelect={handleMenuSelect}
          hints={hints}
          statusSummary={statusSummary}
          columns={columns}
          rows={rows}
        />
      }
    />
  );
}
