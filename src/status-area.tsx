import React from "react";
import { Box, Text } from "@deno-ink/core";
import {
  DENO_VERSION,
  TURBOPANEL_PLATFORM,
  type RepoStatus,
} from "@turbopanel/paths";
import { stackSummary, type StackUnitStatus } from "@turbopanel/stack-status";
import { StatusLine } from "@turbopanel/status-line";

export function StatusArea({
  runtimeReady,
  daemonStatus,
  daemonPresent,
  platformDirectAccess,
  stackUnits,
  instanceReady,
  stackHealthy,
}: {
  runtimeReady: boolean;
  daemonStatus: RepoStatus;
  daemonPresent: boolean;
  platformDirectAccess: boolean;
  stackUnits: StackUnitStatus[];
  instanceReady: boolean;
  stackHealthy: boolean;
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Runtime</Text>
      <StatusLine
        label="Deno runtime"
        ok={runtimeReady}
        detail={runtimeReady
          ? `v${DENO_VERSION} at /opt/turbopanel/runtimes`
          : "run ./console"}
      />

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Platform</Text>
        <Text dimColor>{TURBOPANEL_PLATFORM}</Text>
        <StatusLine
          label="daemon checkout"
          ok={daemonPresent}
          detail={daemonPresent ? daemonStatus.repo : "not installed"}
        />
        {!platformDirectAccess && daemonPresent ? (
          <Text dimColor>
            applying dev ACLs on each ./console launch — no log out/in required
          </Text>
        ) : null}
      </Box>

      {daemonPresent ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Dev stack</Text>
          <Text dimColor>{stackSummary(stackUnits)}</Text>
          {stackUnits.map((unit) => (
            <StatusLine
              key={unit.unit}
              label={unit.label}
              ok={unit.active}
              detail={unit.detail}
            />
          ))}
          <StatusLine
            label="instance.sock"
            ok={instanceReady}
            detail={instanceReady
              ? "/run/turbopanel/instance.sock"
              : stackHealthy
              ? "waiting for instance"
              : "start dev stack"}
          />
          {!instanceReady ? (
            <Text dimColor>
              Developer area unlocks when instance.sock is present
            </Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
