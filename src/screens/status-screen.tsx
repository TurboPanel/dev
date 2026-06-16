import React from "react";
import { Box, Text } from "@deno-ink/core";
import { RuntimeBadge } from "@turbopanel/components/runtime-badge.tsx";
import {
  DENO_VERSION,
  TURBOPANEL_PLATFORM,
  type RepoStatus,
} from "@turbopanel/lib/paths.ts";
import {
  instanceReachable,
  instanceSocketPresent,
  stackSummary,
  type StackUnitStatus,
  wranglerProcessRunning,
} from "@turbopanel/lib/stack-status.ts";
import { readInstanceRuntime } from "@turbopanel/lib/instance-runtime.ts";
import { StatusLine } from "@turbopanel/components/status-line.tsx";

export function StatusScreen({
  runtimeReady,
  daemonStatus,
  daemonPresent,
  platformDirectAccess,
  stackUnits,
  developerUnlocked,
  stackHealthy,
}: {
  runtimeReady: boolean;
  daemonStatus: RepoStatus;
  daemonPresent: boolean;
  platformDirectAccess: boolean;
  stackUnits: StackUnitStatus[];
  developerUnlocked: boolean;
  stackHealthy: boolean;
}) {
  const runtime = readInstanceRuntime();
  const apiReady = instanceReachable();

  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} width="100%">
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
          <Box>
            <Text
              color={runtime === "workers"
                ? (wranglerProcessRunning() ? "green" : "yellow")
                : (apiReady ? "green" : "yellow")}
            >
              {runtime === "workers"
                ? (wranglerProcessRunning() ? "✓ " : "○ ")
                : (apiReady ? "✓ " : "○ ")}
            </Text>
            <Text>instance runtime</Text>
            <Text dimColor> — </Text>
            <RuntimeBadge runtime={runtime} />
            <Text dimColor>
              {runtime === "workers"
                ? " (wrangler via systemd)"
                : " (systemd + socket)"}
            </Text>
          </Box>
          <Text dimColor>{stackSummary(stackUnits)}</Text>
          {stackUnits.map((unit) => (
            <StatusLine
              key={unit.unit}
              label={unit.label}
              ok={unit.active}
              detail={unit.detail}
            />
          ))}
          {runtime === "workers" ? (
            <>
              <StatusLine
                label="wrangler dev"
                ok={wranglerProcessRunning()}
                detail={wranglerProcessRunning()
                  ? "turbopanel-instance.service (systemd)"
                  : "systemctl start turbopanel-instance"}
              />
              <StatusLine
                label="instance API"
                ok={apiReady}
                detail={apiReady
                  ? "reachable via Caddy/wrangler"
                  : "run pnpm dev in platform/instance (console writes .dev.vars)"}
              />
            </>
          ) : (
            <StatusLine
              label="instance.sock"
              ok={instanceSocketPresent()}
              detail={instanceSocketPresent()
                ? "/run/turbopanel/instance.sock"
                : stackHealthy
                ? "waiting for instance"
                : "start dev stack"}
            />
          )}
          {!developerUnlocked ? (
            <Text dimColor>
              {runtime === "workers"
                ? "Developer area unlocks when Caddy is active"
                : "Developer area unlocks when instance.sock is present"}
            </Text>
          ) : !apiReady && runtime === "workers" ? (
            <Text dimColor>
              Developer area open — start wrangler to reach the instance API
            </Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
