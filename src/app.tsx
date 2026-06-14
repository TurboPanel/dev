import React, { useMemo, useState } from "react";
import { Box, SelectInput, Text, useApp, useInput } from "@deno-ink/core";
import { DeveloperConsole } from "@turbopanel/developer-console";
import {
  followLogs,
  readBuildMode,
  startDevStack,
  switchBuildMode,
} from "@turbopanel/daemon-lifecycle";
import { installDaemon } from "@turbopanel/platform-install";
import {
  checkPlatformRepos,
  denoRuntimeInstalled,
  DENO_VERSION,
  TURBOPANEL_PLATFORM,
} from "@turbopanel/paths";
import { StatusLine } from "@turbopanel/status-line";

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
  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useState<"menu" | "developer">("menu");
  const daemonStatus = useMemo(() => checkPlatformRepos()[0], [refresh]);
  const runtimeReady = denoRuntimeInstalled();
  const daemonPresent = daemonStatus.present;
  const developerAvailable = daemonPresent;
  const buildMode = useMemo(
    () => (daemonPresent ? readBuildMode() : null),
    [daemonPresent, refresh],
  );
  const productionBuildActive = buildMode?.uiMode === "static" &&
    buildMode?.instanceRunMode === "compiled";

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

    if (developerAvailable) {
      items.push({ label: "Developer console", value: "developer" });
    }

    items.push({ label: "Refresh status", value: "refresh" });
    items.push({ label: "Quit", value: "quit" });

    return items;
  }, [daemonPresent, developerAvailable, productionBuildActive]);

  useInput((input, key) => {
    if (view === "menu" && (input === "q" || key.escape)) {
      exit();
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

    if (item.value === "developer") {
      setView("developer");
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

  if (view === "developer") {
    return <DeveloperConsole onExit={() => setView("menu")} />;
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        TurboPanel Dev Console
      </Text>
      <Text dimColor>Installer · monitor · developer shell</Text>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Runtime</Text>
        <StatusLine
          label="Deno runtime"
          ok={runtimeReady}
          detail={runtimeReady
            ? `v${DENO_VERSION} at /opt/turbopanel/runtime`
            : "run ./console"}
        />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Platform</Text>
        <Text dimColor>{TURBOPANEL_PLATFORM}</Text>
        <StatusLine
          label="daemon"
          ok={daemonStatus.present}
          detail={daemonStatus.repo}
        />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Menu</Text>
        <SelectInput items={menuItems} onSelect={handleSelect} />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · Enter select · q quit</Text>
      </Box>
    </Box>
  );
}
