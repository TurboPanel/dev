import React, { useMemo, useState } from "react";
import { Box, SelectInput, Text, useApp, useInput } from "@deno-ink/core";
import { installPlatformRepos } from "@turbopanel/platform-install";
import {
  checkPlatformRepos,
  denoRuntimeInstalled,
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

export function App() {
  const { exit } = useApp();
  const [refresh, setRefresh] = useState(0);
  const repos = useMemo(() => checkPlatformRepos(), [refresh]);
  const runtimeReady = denoRuntimeInstalled();
  const reposReady = repos.every((repo) => repo.present);
  const readyCount = repos.filter((repo) => repo.present).length;

  const menuItems = useMemo(() => {
    const items: Array<{ label: string; value: string }> = [];

    if (!reposReady) {
      items.push({
        label: "Install platform repos",
        value: "install",
      });
    }

    items.push({ label: "Refresh status", value: "refresh" });
    items.push({ label: "Quit", value: "quit" });

    return items;
  }, [reposReady]);

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
      queueMicrotask(async () => {
        try {
          await installPlatformRepos();
          Deno.exit(0);
        } catch (error) {
          console.error(error instanceof Error ? error.message : error);
          Deno.exit(1);
        }
      });
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
            ? "installed under /opt/turbopanel/runtime"
            : "run ./console"}
        />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Platform ({readyCount}/{repos.length})</Text>
        <Text dimColor>{TURBOPANEL_PLATFORM}</Text>
        {repos.map((repo) => (
          <StatusLine
            key={repo.dir}
            label={repo.dir}
            ok={repo.present}
            detail={repo.repo}
          />
        ))}
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
