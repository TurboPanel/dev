import { useEffect, useState } from "react";
import { daemonLogLinesEqual } from "../lib/log-lines-equal.ts";
import {
  type DaemonLogByteFloor,
  type DaemonLogFileStat,
  type DaemonLogLine,
  readDaemonLogFileStat,
  readDaemonLogTail,
} from "../lib/daemon-log.ts";

const POLL_MS = 5_000;
// Default tail window. Keep this small so initial render and scroll-back stay
// cheap; reverse infinite scroll can raise it on demand later.
const MAX_LINES = 100;

type DaemonLogSnapshot = {
  stat: DaemonLogFileStat;
  lines: DaemonLogLine[];
};

function readSnapshot(byteFloor?: DaemonLogByteFloor | null): DaemonLogSnapshot {
  return {
    stat: readDaemonLogFileStat(),
    lines: readDaemonLogTail(MAX_LINES, byteFloor),
  };
}

function snapshotEqual(current: DaemonLogSnapshot, next: DaemonLogSnapshot): boolean {
  return (
    daemonLogLinesEqual(current.lines, next.lines) &&
    current.stat.stdoutSize === next.stat.stdoutSize &&
    current.stat.stdoutMtimeMs === next.stat.stdoutMtimeMs &&
    current.stat.stderrSize === next.stat.stderrSize &&
    current.stat.stderrMtimeMs === next.stat.stderrMtimeMs
  );
}

const emptyDaemonSnapshot = (): DaemonLogSnapshot => ({
  stat: {
    stdoutSize: 0,
    stdoutMtimeMs: 0,
    stderrSize: 0,
    stderrMtimeMs: 0,
  },
  lines: [],
});

let daemonLogCache: DaemonLogSnapshot | null = null;

export type DaemonLogState = {
  lines: DaemonLogLine[];
  loading: boolean;
};

type DaemonHookState = {
  refreshKey: number;
  floorKey: string;
  snapshot: DaemonLogSnapshot;
  loading: boolean;
};

function floorKey(byteFloor?: DaemonLogByteFloor | null): string {
  return `${byteFloor?.stdout ?? ""}:${byteFloor?.stderr ?? ""}`;
}

function initialDaemonState(
  refreshKey: number,
  byteFloor?: DaemonLogByteFloor | null,
): DaemonHookState {
  const cached = daemonLogCache;
  return {
    refreshKey,
    floorKey: floorKey(byteFloor),
    snapshot: cached ?? emptyDaemonSnapshot(),
    loading: cached === null,
  };
}

export function useDaemonLog(
  byteFloor?: DaemonLogByteFloor | null,
  refreshKey = 0,
): DaemonLogState {
  const nextFloorKey = floorKey(byteFloor);
  const [state, setState] = useState<DaemonHookState>(() =>
    initialDaemonState(refreshKey, byteFloor),
  );

  if (state.refreshKey !== refreshKey || state.floorKey !== nextFloorKey) {
    setState(initialDaemonState(refreshKey, byteFloor));
  }

  useEffect(() => {
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | undefined;
    const hadCache = daemonLogCache !== null;

    const refresh = () => {
      const next = readSnapshot(byteFloor);
      if (cancelled) {
        return;
      }
      daemonLogCache = next;
      setState((current) => {
        if (current.refreshKey !== refreshKey || current.floorKey !== nextFloorKey) {
          return current;
        }
        if (snapshotEqual(current.snapshot, next) && !current.loading) {
          return current;
        }
        return {
          refreshKey,
          floorKey: nextFloorKey,
          snapshot: next,
          loading: false,
        };
      });
    };

    const deferId = setTimeout(() => {
      if (!hadCache) {
        refresh();
      }
      pollId = setInterval(() => refresh(), POLL_MS);
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(deferId);
      if (pollId !== undefined) {
        clearInterval(pollId);
      }
    };
  }, [byteFloor?.stdout, byteFloor?.stderr, refreshKey, nextFloorKey]);

  return { lines: state.snapshot.lines, loading: state.loading };
}
