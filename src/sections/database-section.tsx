import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "@deno-ink/core";
import {
  drizzleStudioOpenUrl,
  fetchDatabaseStatus,
  fetchDrizzleStudioStatus,
  startDrizzleStudio,
  type DatabaseStatus,
  type DrizzleStudioStatus,
} from "@turbopanel/lib/instance-client.ts";
import type { DeveloperState } from "@turbopanel/hooks/use-developer-state.ts";

const ACTIONS = [
  "Test connection",
  "Start Drizzle Studio",
] as const;

export function DatabaseSection({
  state,
  interactable = false,
}: {
  state: DeveloperState;
  interactable?: boolean;
}) {
  const { healthOk, recovery } = state;
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [studioStatus, setStudioStatus] = useState<DrizzleStudioStatus | null>(
    null,
  );
  const [actionIndex, setActionIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const refreshStatus = async () => {
    if (recovery?.active) return;
    const [dbStatus, studio] = await Promise.all([
      fetchDatabaseStatus().catch(() => null),
      fetchDrizzleStudioStatus().catch(() => null),
    ]);
    setStatus(dbStatus);
    setStudioStatus(studio);
  };

  useEffect(() => {
    if (recovery?.active) return;
    void refreshStatus();
    const timer = setInterval(() => void refreshStatus(), 5000);
    return () => clearInterval(timer);
  }, [recovery?.active]);

  const runAction = async (action: typeof ACTIONS[number]) => {
    setBusy(true);
    setMessage(null);
    try {
      if (action === "Test connection") {
        const dbStatus = await fetchDatabaseStatus();
        setStatus(dbStatus);
        setMessage({
          ok: dbStatus.connected,
          text: dbStatus.connected
            ? dbStatus.version
              ? `Connected via ${dbStatus.transport ?? "url"}. ${dbStatus.version}`
              : `Connected via ${dbStatus.transport ?? "url"}.`
            : dbStatus.error ?? "Not connected",
        });
      } else if (action === "Start Drizzle Studio") {
        const result = await startDrizzleStudio();
        const studio = await fetchDrizzleStudioStatus().catch(() => null);
        setStudioStatus(studio);
        const url = result.browserUrl ||
          studio?.browserUrl ||
          drizzleStudioOpenUrl();
        setMessage({
          ok: true,
          text: studio?.running
            ? `Studio running on port ${studio?.port ?? result.port}. Open ${url}`
            : `Studio started on port ${result.port}. Open ${url}`,
        });
      }
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof Error ? err.message : "Action failed",
      });
    } finally {
      setBusy(false);
    }
  };

  useInput((input, key) => {
    if (!interactable) return;

    if (key.upArrow) {
      setActionIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setActionIndex((i) => Math.min(ACTIONS.length - 1, i + 1));
    } else if (key.return && !busy && (healthOk || recovery?.active)) {
      const action = ACTIONS[actionIndex];
      if (
        action === "Start Drizzle Studio" && status?.configured === true
      ) {
        void runAction(action);
      } else if (action === "Test connection") {
        void runAction(action);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text
          color={recovery?.active
            ? "yellow"
            : status === null
            ? "yellow"
            : status.connected
            ? "green"
            : "red"}
        >
          ●{" "}
        </Text>
        <Text>
          {recovery?.active
            ? recovery.message
            : status === null
            ? "Checking database…"
            : !status.configured
            ? "Postgres not configured"
            : status.connected
            ? `Connected via ${status.transport}`
            : "Configured but unreachable"}
        </Text>
      </Box>
      {recovery?.active ? null : status?.configured ? (
        <Box marginTop={1}>
          <Text dimColor>
            Database {status.database ?? "—"} as {status.user ?? "—"}
            {status.version ? ` · ${status.version}` : ""}
          </Text>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text dimColor>
            Set TURBOPANEL_DATABASE_URL on the instance unit — a full Postgres
            URL, typically injected by the instance-launch role on managed hosts.
          </Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text color={studioStatus?.running ? "green" : "yellow"}>
          {studioStatus === null
            ? "Checking studio status…"
            : studioStatus.running
            ? `Running on port ${studioStatus.port}`
            : "Not running"}
        </Text>
        {studioStatus?.running ? (
          <Text dimColor>
            Open {studioStatus.browserUrl}
          </Text>
        ) : (
          <Text dimColor>
            Studio auto-starts in dev; use Start Drizzle Studio to retry.
          </Text>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>Actions</Text>
        {ACTIONS.map((action, index) => (
          <Text
            key={action}
            color={index === actionIndex ? "cyan" : undefined}
            bold={index === actionIndex}
          >
            {index === actionIndex ? "› " : "  "}{action}
            {action === "Start Drizzle Studio" && studioStatus?.running
              ? " (already running)"
              : ""}
          </Text>
        ))}
      </Box>

      {message ? (
        <Box marginTop={1}>
          <Text color={message.ok ? "green" : "red"}>{message.text}</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>
          {interactable
            ? "↑↓ select · Enter run · Esc back · m menu to reset dev environment"
            : "Enter to focus"}
        </Text>
      </Box>
    </Box>
  );
}
