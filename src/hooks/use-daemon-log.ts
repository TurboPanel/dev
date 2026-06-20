import { useEffect, useState } from "react";
import { daemonLogLinesEqual } from "../lib/log-lines-equal.ts";
import {
  type DaemonLogFileStat,
  type DaemonLogLine,
  readDaemonLogFileStat,
  readDaemonLogTail,
} from "../lib/daemon-log.ts";

const POLL_MS = 1000;
const MAX_LINES = 1000;

type DaemonLogSnapshot = {
  stat: DaemonLogFileStat;
  lines: DaemonLogLine[];
};

function readSnapshot(): DaemonLogSnapshot {
  return {
    stat: readDaemonLogFileStat(),
    lines: readDaemonLogTail(MAX_LINES),
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

export function useDaemonLog(): DaemonLogLine[] {
  const [snapshot, setSnapshot] = useState<DaemonLogSnapshot>(readSnapshot);

  useEffect(() => {
    const refresh = () => {
      const next = readSnapshot();
      setSnapshot((current) => (snapshotEqual(current, next) ? current : next));
    };
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, []);

  return snapshot.lines;
}
