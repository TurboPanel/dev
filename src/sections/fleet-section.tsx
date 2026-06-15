import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "@deno-ink/core";
import {
  daemonLabel,
  fetchUpgradeStatus,
  setInstanceTunnelToken,
  syncDevToAllDaemons,
  upgradeSystem,
  type DirtyRepo,
} from "@turbopanel/instance-client";
import type { DeveloperState } from "@turbopanel/use-developer-state";

const ACTIONS = ["Upgrade System", "Sync Dev Build", "Save Tunnel Token"] as const;

export function FleetSection({
  state,
  interactable = false,
  onEditingChange,
}: {
  state: DeveloperState;
  interactable?: boolean;
  onEditingChange?: (editing: boolean) => void;
}) {
  const { healthOk, connections, fleet, staleCount } = state;
  const [dirtyRepos, setDirtyRepos] = useState<DirtyRepo[]>([]);
  const [actionIndex, setActionIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [promptMode, setPromptMode] = useState<"token" | null>(null);
  const [tokenInput, setTokenInput] = useState("");

  useEffect(() => {
    onEditingChange?.(promptMode === "token");
    return () => onEditingChange?.(false);
  }, [promptMode, onEditingChange]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await fetchUpgradeStatus();
        if (!cancelled) setDirtyRepos(status.dirty);
      } catch {
        if (!cancelled) setDirtyRepos([]);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const runAction = async (action: typeof ACTIONS[number]) => {
    setBusy(true);
    setMessage(null);
    try {
      if (action === "Upgrade System") {
        const result = await upgradeSystem();
        setMessage({
          ok: true,
          text:
            `Upgrade started at commit ${result.commit}. Instance will restart shortly.`,
        });
      } else if (action === "Sync Dev Build") {
        const result = await syncDevToAllDaemons();
        const failed = result.results.filter((r) => !r.ok);
        setMessage({
          ok: result.ok,
          text: result.ok
            ? `Pushed daemon build to ${result.results.length} daemon(s).`
            : `Sync errors: ${
              failed.map((r) => `${r.daemonId} (${r.error ?? "failed"})`).join(
                ", ",
              )
            }`,
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

  const saveToken = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await setInstanceTunnelToken(tokenInput.trim());
      setMessage({
        ok: true,
        text: tokenInput.trim()
          ? "Tunnel token saved; cloudflared starting."
          : "Tunnel token cleared.",
      });
      setTokenInput("");
      setPromptMode(null);
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof Error ? err.message : "Failed to set tunnel token",
      });
    } finally {
      setBusy(false);
    }
  };

  useInput((input, key) => {
    if (promptMode === "token") {
      if (key.return) {
        void saveToken();
        return;
      }
      if (key.escape) {
        setPromptMode(null);
        setTokenInput("");
        return;
      }
      if (key.backspace || key.delete) {
        setTokenInput((value) => value.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setTokenInput((value) => value + input);
      }
      return;
    }

    if (!interactable) return;

    if (key.upArrow) {
      setActionIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setActionIndex((i) => Math.min(ACTIONS.length - 1, i + 1));
    } else if (key.return && !busy) {
      const action = ACTIONS[actionIndex];
      if (action === "Save Tunnel Token") {
        setPromptMode("token");
      } else if (
        action === "Upgrade System" &&
        healthOk &&
        dirtyRepos.length === 0
      ) {
        void runAction(action);
      } else if (action === "Sync Dev Build" && healthOk && fleet.length > 0) {
        void runAction(action);
      }
    }
  });

  return (
    <Box flexDirection="column">
      {dirtyRepos.length > 0 ? (
        <Box marginTop={1}>
          <Text color="red">
            Uncommitted changes block upgrade:{" "}
            {dirtyRepos.map((e) => `${e.repo} (${e.changes})`).join(", ")}
          </Text>
        </Box>
      ) : null}

      <Box flexDirection="column" marginTop={dirtyRepos.length > 0 ? 1 : 0}>
        {ACTIONS.map((action, index) => (
          <Text
            key={action}
            color={index === actionIndex ? "cyan" : undefined}
            bold={index === actionIndex}
          >
            {index === actionIndex ? "› " : "  "}{action}
            {busy && index === actionIndex ? " …" : ""}
          </Text>
        ))}
      </Box>

      {promptMode === "token" ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Tunnel token (empty to clear):</Text>
          <Text>{tokenInput ? "•".repeat(tokenInput.length) : "(empty)"}</Text>
        </Box>
      ) : null}

      {message ? (
        <Box marginTop={1}>
          <Text color={message.ok ? "green" : "red"}>{message.text}</Text>
        </Box>
      ) : null}

      <Box flexDirection="column" marginTop={1}>
        {fleet.length === 0 ? (
          <Text dimColor>Waiting for daemon connections…</Text>
        ) : (
          fleet.map((conn) => (
            <Box key={conn.id} marginTop={1}>
              <Text bold>{daemonLabel(conn.id, connections)}</Text>
              <Text dimColor>
                {conn.hostname ?? conn.id}
                {conn.remoteAddress ? ` · ${conn.remoteAddress}` : ""}
                {staleCount > 0 ? ` · ${staleCount} stale` : ""}
              </Text>
            </Box>
          ))
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {promptMode === "token"
            ? "Enter save · Esc cancel"
            : interactable
            ? "↑↓ select · Enter run · Esc back"
            : "Enter to focus"}
        </Text>
      </Box>
    </Box>
  );
}
