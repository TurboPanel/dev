import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "@deno-ink/core";
import {
  drizzleStudioOpenUrl,
  fetchDatabaseStatus,
  fetchDrizzleStudioStatus,
  resetDevInstance,
  startDrizzleStudio,
  type DatabaseStatus,
  type DrizzleStudioStatus,
} from "@turbopanel/instance-client";
import type { DeveloperState } from "@turbopanel/use-developer-state";

const ACTIONS = [
  "Test connection",
  "Start Drizzle Studio",
  "Reset Dev Instance",
] as const;

export function DatabaseSection({
  state,
  interactable = false,
}: {
  state: DeveloperState;
  interactable?: boolean;
}) {
  const { healthOk } = state;
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [studioStatus, setStudioStatus] = useState<DrizzleStudioStatus | null>(
    null,
  );
  const [actionIndex, setActionIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [confirmReset, setConfirmReset] = useState(false);

  const refreshStatus = async () => {
    const [dbStatus, studio] = await Promise.all([
      fetchDatabaseStatus().catch(() => null),
      fetchDrizzleStudioStatus().catch(() => null),
    ]);
    setStatus(dbStatus);
    setStudioStatus(studio);
  };

  useEffect(() => {
    void refreshStatus();
    const timer = setInterval(() => void refreshStatus(), 5000);
    return () => clearInterval(timer);
  }, []);

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
      } else if (action === "Reset Dev Instance") {
        await resetDevInstance();
        setMessage({
          ok: true,
          text: "Dev instance reset started; instance is restarting.",
        });
        setConfirmReset(false);
      }
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof Error ? err.message : "Action failed",
      });
      setConfirmReset(false);
    } finally {
      setBusy(false);
    }
  };

  useInput((input, key) => {
    if (confirmReset) {
      if (input === "y" || input === "Y") {
        void runAction("Reset Dev Instance");
      } else if (input === "n" || input === "N" || key.escape) {
        setConfirmReset(false);
      }
      return;
    }

    if (!interactable) return;

    if (key.upArrow) {
      setActionIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setActionIndex((i) => Math.min(ACTIONS.length - 1, i + 1));
    } else if (key.return && !busy && healthOk) {
      const action = ACTIONS[actionIndex];
      if (action === "Reset Dev Instance") {
        setConfirmReset(true);
      } else if (
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
      <Text bold>Database</Text>
      <Text dimColor>{"─".repeat(40)}</Text>
      <Box marginTop={1}>
        <Text
          color={status === null ? "yellow" : status.connected ? "green" : "red"}
        >
          ●{" "}
        </Text>
        <Text>
          {status === null
            ? "Checking database…"
            : !status.configured
            ? "Postgres not configured"
            : status.connected
            ? `Connected via ${status.transport}`
            : "Configured but unreachable"}
        </Text>
      </Box>
      {status?.configured ? (
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
        <Text bold>Drizzle Studio</Text>
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
            Use Start Drizzle Studio to launch the local browser UI.
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

      {confirmReset ? (
        <Box marginTop={1}>
          <Text color="yellow">
            Reset dev instance? Drops all Postgres data.
          </Text>
        </Box>
      ) : null}

      {message ? (
        <Box marginTop={1}>
          <Text color={message.ok ? "green" : "red"}>{message.text}</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>
          {confirmReset
            ? "y reset · N cancel · Esc cancel"
            : interactable
            ? "↑↓ select · Enter run · Esc back"
            : "Enter to focus"}
        </Text>
      </Box>
    </Box>
  );
}
