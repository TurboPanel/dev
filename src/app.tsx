import React from "react";
import { Box, Text, useApp, useInput } from "@deno-ink/core";
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
  const repos = checkPlatformRepos();
  const runtimeReady = denoRuntimeInstalled();
  const reposReady = repos.every((repo) => repo.present);
  const readyCount = repos.filter((repo) => repo.present).length;

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      exit();
    }
  });

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
          detail={runtimeReady ? "installed under /opt/turbopanel/runtime" : "run ./dev.sh"}
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
        <Text bold>Next steps</Text>
        {!runtimeReady && <Text>Run ./dev.sh to install the runtime and start the console</Text>}
        {!reposReady && (
          <Text>
            {runtimeReady ? "1" : "2"}. Platform repos will be installed from this console
          </Text>
        )}
        {runtimeReady && reposReady && (
          <Text color="green">Platform sources are present. More tooling coming soon.</Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Press q to quit</Text>
      </Box>
    </Box>
  );
}
