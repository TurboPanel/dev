import React, { useEffect, useMemo, useState } from "react";
import { Box, SelectInput, Text, useApp, useInput } from "@deno-ink/core";
import { AreaTabs, type AreaTab } from "@turbopanel/area-tabs";
import { DeveloperPanels } from "@turbopanel/developer-console";
import {
  followLogs,
  readBuildMode,
  startDevStack,
  switchBuildMode,
} from "@turbopanel/daemon-lifecycle";
import { InstanceArea } from "@turbopanel/instance-area";
import { switchInstanceRuntime } from "@turbopanel/instance-runtime";
import { installDaemon } from "@turbopanel/platform-install";
import {
  checkPlatformRepos,
  denoRuntimeInstalled,
  platformRepoPath,
} from "@turbopanel/paths";
import {
  fetchStackStatus,
  instanceSocketPresent,
  stackSummary,
} from "@turbopanel/stack-status";
import { StatusArea } from "@turbopanel/status-area";
import { useDeveloperState } from "@turbopanel/use-developer-state";

async function runAfterExit(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    Deno.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}

function areaHelp(areaId: string, panelFocused: boolean): string {
  switch (areaId) {
    case "status":
      return "← → areas · q quit";
    case "instance":
      return "← → areas · ↑↓ actions · Enter · q quit";
    case "developer":
      return panelFocused
        ? "← → areas · Esc back · q quit"
        : "← → areas · ↑↓ sections · Enter open · t target · q quit";
    default:
      return "← → areas · ↑↓ menu · Enter · q quit";
  }
}

export function App() {
  const { exit } = useApp();
  const [refresh, setRefresh] = useState(0);
  const [developerEditing, setDeveloperEditing] = useState(false);
  const [developerPanelFocused, setDeveloperPanelFocused] = useState(false);
  const [activeAreaId, setActiveAreaId] = useState("status");
  const daemonStatus = useMemo(() => checkPlatformRepos()[0], [refresh]);
  const runtimeReady = denoRuntimeInstalled();
  const daemonPresent = daemonStatus.present;
  const stackUnits = useMemo(() => fetchStackStatus(), [refresh]);
  const stackHealthy = useMemo(
    () => stackUnits.some((unit) => unit.active === true),
    [stackUnits],
  );
  const instanceReady = useMemo(() => instanceSocketPresent(), [refresh]);
  const developerState = useDeveloperState(instanceReady);
  const buildMode = useMemo(
    () => (daemonPresent ? readBuildMode() : null),
    [daemonPresent, refresh],
  );
  const productionBuildActive = buildMode?.uiMode === "static" &&
    buildMode?.instanceRunMode === "compiled";
  const platformDirectAccess = useMemo(() => {
    try {
      Deno.statSync(platformRepoPath("daemon"));
      return true;
    } catch {
      return false;
    }
  }, [refresh]);

  const areas = useMemo(() => {
    const list: AreaTab[] = [{ id: "status", label: "Status" }];
    list.push({ id: "instance", label: "Instance" });
    if (instanceReady) {
      list.push({ id: "developer", label: "Developer" });
    }
    list.push({ id: "actions", label: "Actions" });
    return list;
  }, [instanceReady]);

  const activeAreaIndex = areas.findIndex((area) => area.id === activeAreaId);
  const resolvedAreaIndex = activeAreaIndex === -1 ? 0 : activeAreaIndex;
  const activeArea = areas[resolvedAreaIndex];

  useEffect(() => {
    if (!areas.some((area) => area.id === activeAreaId)) {
      setActiveAreaId(areas[areas.length - 1].id);
    }
  }, [activeAreaId, areas]);

  const menuItems = useMemo(() => {
    const items: Array<{ label: string; value: string }> = [
      { label: "Install/update daemon", value: "install" },
    ];

    if (daemonPresent) {
      items.push({ label: "Start dev stack", value: "start" });
      items.push({ label: "Follow logs", value: "logs" });

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

    items.push({ label: "Refresh status", value: "refresh" });
    items.push({ label: "Quit", value: "quit" });

    return items;
  }, [daemonPresent, productionBuildActive]);

  useInput((input, key) => {
    if (developerEditing) return;

    if (key.escape && developerPanelFocused) return;

    if (input === "q" || key.escape) {
      exit();
      return;
    }

    if (key.leftArrow) {
      const currentIndex = areas.findIndex((area) => area.id === activeAreaId);
      const index = currentIndex === -1 ? 0 : currentIndex;
      const next = index <= 0 ? areas.length - 1 : index - 1;
      setActiveAreaId(areas[next].id);
      return;
    }

    if (key.rightArrow) {
      const currentIndex = areas.findIndex((area) => area.id === activeAreaId);
      const index = currentIndex === -1 ? 0 : currentIndex;
      const next = index >= areas.length - 1 ? 0 : index + 1;
      setActiveAreaId(areas[next].id);
    }
  });

  const handleSelect = (item: { label: string; value: string }) => {
    if (item.value === "quit") {
      exit();
      return;
    }

    if (item.value === "refresh") {
      setRefresh((count) => count + 1);
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

    if (item.value === "build-production") {
      exit();
      queueMicrotask(() => runAfterExit(() => switchBuildMode("production")));
      return;
    }

    if (item.value === "build-dev") {
      exit();
      queueMicrotask(() => runAfterExit(() => switchBuildMode("dev")));
    }
  };

  const headerSummary = instanceReady
    ? `${stackSummary(stackUnits)} · ${developerState.fleet.length} server${
      developerState.fleet.length === 1 ? "" : "s"
    }`
    : daemonPresent
    ? stackSummary(stackUnits)
    : runtimeReady
    ? "runtime ready"
    : "getting started";

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        TurboPanel Dev Console
      </Text>
      <Text dimColor>{headerSummary}</Text>

      <AreaTabs areas={areas} activeIndex={resolvedAreaIndex} />

      {activeArea.id === "status" ? (
        <StatusArea
          runtimeReady={runtimeReady}
          daemonStatus={daemonStatus}
          daemonPresent={daemonPresent}
          platformDirectAccess={platformDirectAccess}
          stackUnits={stackUnits}
          instanceReady={instanceReady}
          stackHealthy={stackHealthy}
        />
      ) : null}

      {activeArea.id === "instance" ? (
        <InstanceArea
          onSwitch={(target) => {
            exit();
            queueMicrotask(() =>
              runAfterExit(() => switchInstanceRuntime(target))
            );
          }}
        />
      ) : null}

      {activeArea.id === "developer" && instanceReady ? (
        <DeveloperPanels
          state={developerState}
          onEditingChange={setDeveloperEditing}
          onPanelFocusChange={setDeveloperPanelFocused}
        />
      ) : null}

      {activeArea.id === "actions" ? (
        <Box flexDirection="column" marginTop={1}>
          <SelectInput items={menuItems} onSelect={handleSelect} />
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>{areaHelp(activeArea.id, developerPanelFocused)}</Text>
      </Box>
    </Box>
  );
}
