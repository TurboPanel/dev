import { useCallback, useEffect, useMemo, useState } from "react";
import {
  daemonLabel,
  fetchCommandResults,
  fetchDaemonConnections,
  fetchDaemonEvents,
  fetchHealth,
  uniqueFleetConnections,
  type CommandResult,
  type DaemonConnection,
  type DaemonEvent,
} from "@turbopanel/lib/instance-client.ts";
import {
  type InstanceRecoverySnapshot,
  waitForInstanceRecovery,
} from "@turbopanel/lib/instance-recovery.ts";
import { withTimeout } from "@turbopanel/lib/fetch-timeout.ts";

export const ALL_TARGET = "__all__";

const POLL_MS = 3_000;
const FETCH_TIMEOUT_MS = 4_000;

export type DeveloperState = {
  healthOk: boolean | null;
  connections: DaemonConnection[];
  events: DaemonEvent[];
  commands: CommandResult[];
  error: string | null;
  recovery: InstanceRecoverySnapshot | null;
  target: string;
  setTarget: (target: string) => void;
  fleet: DaemonConnection[];
  targetLabel: string;
  staleCount: number;
  refresh: () => Promise<void>;
  startInstanceRecovery: (reason: string) => Promise<boolean>;
};

export function useDeveloperState(enabled = true): DeveloperState {
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [connections, setConnections] = useState<DaemonConnection[]>([]);
  const [events, setEvents] = useState<DaemonEvent[]>([]);
  const [commands, setCommands] = useState<CommandResult[]>([]);
  const [target, setTarget] = useState<string>(ALL_TARGET);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<InstanceRecoverySnapshot | null>(
    null,
  );

  const refresh = useCallback(async () => {
    if (recovery?.active) {
      return;
    }
    try {
      const [health, conn, ev, cmd] = await Promise.all([
        withTimeout(fetchHealth(), FETCH_TIMEOUT_MS, "health"),
        withTimeout(fetchDaemonConnections(), FETCH_TIMEOUT_MS, "connections"),
        withTimeout(fetchDaemonEvents(), FETCH_TIMEOUT_MS, "events"),
        withTimeout(fetchCommandResults(), FETCH_TIMEOUT_MS, "commands"),
      ]);
      setHealthOk(health.ok);
      setConnections(conn.connections);
      setEvents(ev.events);
      setCommands(cmd.commands);
      setError(null);
    } catch (err) {
      setHealthOk(false);
      setError(err instanceof Error ? err.message : "Failed to reach instance");
    }
  }, [recovery]);

  const startInstanceRecovery = useCallback(async (reason: string) => {
    setError(null);
    setHealthOk(false);
    const ready = await waitForInstanceRecovery(reason, setRecovery);
    setRecovery(null);
    if (ready) {
      await refresh();
    } else {
      setError("Instance did not recover within 2 minutes — check journalctl -u turbopanel-instance");
    }
    return ready;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, refresh]);

  const fleet = useMemo(
    () => uniqueFleetConnections(connections),
    [connections],
  );

  const targetExists = useMemo(
    () => target === ALL_TARGET || fleet.some((c) => c.id === target),
    [target, fleet],
  );

  useEffect(() => {
    if (!targetExists) setTarget(ALL_TARGET);
  }, [targetExists]);

  const targetLabel = target === ALL_TARGET
    ? "all servers"
    : daemonLabel(target, connections);

  const staleCount = connections.length - fleet.length;

  return {
    healthOk,
    connections,
    events,
    commands,
    error,
    recovery,
    target,
    setTarget,
    fleet,
    targetLabel,
    staleCount,
    refresh,
    startInstanceRecovery,
  };
}
