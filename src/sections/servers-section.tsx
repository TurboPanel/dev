import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "@deno-ink/core";
import {
  createServer,
  fetchOrganizations,
  fetchServers,
  updateServer,
  type OrganizationRecord,
  type ServerRecord,
} from "@turbopanel/instance-client";

function organizationLabel(
  organizationId: string | null,
  organizations: OrganizationRecord[],
): string {
  if (!organizationId) return "Unassigned";
  const org = organizations.find((entry) => entry.id === organizationId);
  if (!org) return organizationId;
  return org.slug ? `${org.displayName} (${org.slug})` : org.displayName;
}

type Mode =
  | { kind: "browse"; serverIndex: number }
  | { kind: "add"; input: string }
  | { kind: "edit"; serverId: string; input: string }
  | { kind: "assign"; serverId: string; orgIndex: number };

export function ServersSection({
  onEditingChange,
}: {
  onEditingChange?: (editing: boolean) => void;
}) {
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "browse", serverIndex: 0 });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    onEditingChange?.(mode.kind === "add" || mode.kind === "edit");
    return () => onEditingChange?.(false);
  }, [mode, onEditingChange]);

  const loadServers = async () => {
    setLoading(true);
    setError(null);
    try {
      const [serverResult, orgResult] = await Promise.all([
        fetchServers(),
        fetchOrganizations(),
      ]);
      setServers(serverResult.servers);
      setOrganizations(orgResult.organizations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load servers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadServers();
  }, []);

  const currentServer = mode.kind === "browse" && servers.length > 0
    ? servers[Math.min(mode.serverIndex, servers.length - 1)]
    : null;

  useInput((input, key) => {
    if (mode.kind === "add" || mode.kind === "edit") {
      if (key.return) {
        void (async () => {
          try {
            if (mode.kind === "add") {
              await createServer({ displayName: mode.input.trim() || null });
              setMessage("Server added.");
            } else {
              await updateServer(mode.serverId, {
                displayName: mode.input.trim() || null,
              });
              setMessage("Display name updated.");
            }
            setMode({ kind: "browse", serverIndex: 0 });
            await loadServers();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Save failed");
          }
        })();
        return;
      }
      if (key.escape) {
        setMode({ kind: "browse", serverIndex: 0 });
        return;
      }
      if (key.backspace || key.delete) {
        setMode((m) =>
          m.kind === "add" || m.kind === "edit"
            ? { ...m, input: m.input.slice(0, -1) }
            : m
        );
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setMode((m) =>
          m.kind === "add" || m.kind === "edit"
            ? { ...m, input: m.input + input }
            : m
        );
      }
      return;
    }

    if (mode.kind === "assign") {
      const orgOptions = [null, ...organizations.map((o) => o.id)];
      if (key.leftArrow || key.upArrow) {
        setMode((m) =>
          m.kind === "assign"
            ? { ...m, orgIndex: Math.max(0, m.orgIndex - 1) }
            : m
        );
      } else if (key.rightArrow || key.downArrow) {
        setMode((m) =>
          m.kind === "assign"
            ? {
              ...m,
              orgIndex: Math.min(orgOptions.length - 1, m.orgIndex + 1),
            }
            : m
        );
      } else if (key.return) {
        void (async () => {
          try {
            const orgId = orgOptions[mode.orgIndex];
            await updateServer(mode.serverId, { organizationId: orgId });
            setMessage("Organization assigned.");
            setMode({ kind: "browse", serverIndex: 0 });
            await loadServers();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Assign failed");
          }
        })();
      } else if (key.escape) {
        setMode({ kind: "browse", serverIndex: 0 });
      }
      return;
    }

    if (mode.kind === "browse") {
      if (key.upArrow && servers.length > 0) {
        setMode((m) =>
          m.kind === "browse"
            ? {
              kind: "browse",
              serverIndex: Math.max(0, m.serverIndex - 1),
            }
            : m
        );
      } else if (key.downArrow && servers.length > 0) {
        setMode((m) =>
          m.kind === "browse"
            ? {
              kind: "browse",
              serverIndex: Math.min(servers.length - 1, m.serverIndex + 1),
            }
            : m
        );
      } else if (input === "a") {
        setMode({ kind: "add", input: "" });
      } else if (input === "e" && currentServer) {
        setMode({
          kind: "edit",
          serverId: currentServer.id,
          input: currentServer.displayName ?? "",
        });
      } else if (input === "o" && currentServer) {
        const orgIndex = currentServer.organizationId
          ? organizations.findIndex((o) => o.id === currentServer.organizationId) +
            1
          : 0;
        setMode({
          kind: "assign",
          serverId: currentServer.id,
          orgIndex: Math.max(0, orgIndex),
        });
      }
    }
  });

  const orgOptions = [null, ...organizations.map((o) => o.id)];

  return (
    <Box flexDirection="column">
      <Text bold>Servers</Text>
      <Box marginTop={1}>
        <Text dimColor>
          a add · e edit name · o assign org · ↑↓ select server
        </Text>
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      ) : null}
      {message ? (
        <Box marginTop={1}>
          <Text color="green">{message}</Text>
        </Box>
      ) : null}

      {mode.kind === "add" ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>New server display name:</Text>
          <Text>{mode.input || "(empty)"}</Text>
        </Box>
      ) : null}

      {mode.kind === "edit" ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Edit display name:</Text>
          <Text>{mode.input || "(empty)"}</Text>
        </Box>
      ) : null}

      {mode.kind === "assign" ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Assign organization (←→ · Enter):</Text>
          {orgOptions.map((orgId, index) => {
            const label = orgId === null
              ? "Unassigned"
              : organizationLabel(orgId, organizations);
            return (
              <Text
                key={orgId ?? "none"}
                color={index === mode.orgIndex ? "cyan" : undefined}
                bold={index === mode.orgIndex}
              >
                {index === mode.orgIndex ? "› " : "  "}{label}
              </Text>
            );
          })}
        </Box>
      ) : null}

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Registered servers</Text>
        {loading && servers.length === 0 ? (
          <Text dimColor>Loading…</Text>
        ) : servers.length === 0 ? (
          <Text dimColor>No servers registered yet.</Text>
        ) : (
          servers.map((server, index) => (
            <Box
              key={server.id}
              flexDirection="column"
              marginTop={1}
            >
              <Text
                bold={mode.kind === "browse" && index === mode.serverIndex}
                color={mode.kind === "browse" && index === mode.serverIndex
                  ? "cyan"
                  : undefined}
              >
                {mode.kind === "browse" && index === mode.serverIndex ? "› " : "  "}
                {server.displayName ?? server.id}
              </Text>
              <Text dimColor>  ID: {server.id}</Text>
              <Text dimColor>
                {"  "}Organization:{" "}
                {organizationLabel(server.organizationId, organizations)}
              </Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
