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
} from "@turbopanel/instance-client";

export const ALL_TARGET = "__all__";

const POLL_MS = 2_000;

export type DeveloperState = {
  healthOk: boolean | null;
  connections: DaemonConnection[];
  events: DaemonEvent[];
  commands: CommandResult[];
  error: string | null;
  target: string;
  setTarget: (target: string) => void;
  fleet: DaemonConnection[];
  targetLabel: string;
  staleCount: number;
  refresh: () => Promise<void>;
};

export function useDeveloperState(): DeveloperState {
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [connections, setConnections] = useState<DaemonConnection[]>([]);
  const [events, setEvents] = useState<DaemonEvent[]>([]);
  const [commands, setCommands] = useState<CommandResult[]>([]);
  const [target, setTarget] = useState<string>(ALL_TARGET);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [health, conn, ev, cmd] = await Promise.all([
        fetchHealth(),
        fetchDaemonConnections(),
        fetchDaemonEvents(),
        fetchCommandResults(),
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
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

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
    target,
    setTarget,
    fleet,
    targetLabel,
    staleCount,
    refresh,
  };
}
