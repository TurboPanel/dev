import React, { useMemo, useState } from "react";
import { Box, SelectInput, Text, useApp, useInput } from "@deno-ink/core";
import { followLogs, startDevStack } from "@turbopanel/daemon-lifecycle";
import { installDaemon } from "@turbopanel/platform-install";
import {
  checkPlatformRepos,
  denoRuntimeInstalled,
  DENO_VERSION,
  TURBOPANEL_PLATFORM,
} from "@turbopanel/paths";

function StatusLine({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <Box>
      <Text color={ok ? "green" : "yellow"}>{ok ? "✓" : "○"} </Text>
      <Text>{label}</Text>
      <Text dimColor> — {detail}</Text>
    </Box>
  );
}

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
  const daemonStatus = useMemo(() => checkPlatformRepos()[0], [refresh]);
  const runtimeReady = denoRuntimeInstalled();
  const daemonPresent = daemonStatus.present;

  const menuItems = useMemo(() => {
    const items: Array<{ label: string; value: string }> = [
      { label: "Install/update daemon", value: "install" },
    ];

    if (daemonPresent) {
      items.push({ label: "Start dev stack", value: "start" });
      items.push({ label: "Follow logs", value: "logs" });
    }

    items.push({ label: "Refresh status", value: "refresh" });
    items.push({ label: "Quit", value: "quit" });

    return items;
  }, [daemonPresent]);

  useInput((input, key) => {
    if (input === "q" || key.escape) {
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
    }
  };

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
