import { useEffect, useState } from "react";
import { daemonLogLinesEqual } from "../lib/log-lines-equal.ts";
import {
  type DaemonLogByteFloor,
  type DaemonLogFileStat,
  type DaemonLogLine,
  readDaemonLogFileStat,
  readDaemonLogTail,
} from "../lib/daemon-log.ts";

const POLL_MS = 1000;
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

export function useDaemonLog(
  byteFloor?: DaemonLogByteFloor | null,
  refreshKey = 0,
): DaemonLogLine[] {
  const [snapshot, setSnapshot] = useState<DaemonLogSnapshot>(() =>
    readSnapshot(byteFloor),
  );

  useEffect(() => {
    const refresh = () => {
      const next = readSnapshot(byteFloor);
      setSnapshot((current) => (snapshotEqual(current, next) ? current : next));
    };
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [byteFloor?.stdout, byteFloor?.stderr, refreshKey]);

  return snapshot.lines;
}
