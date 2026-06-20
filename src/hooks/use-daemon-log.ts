import { useEffect, useState } from "react";
import { daemonLogLinesEqual } from "../lib/log-lines-equal.ts";
import {
  type DaemonLogLine,
  readDaemonLogTail,
} from "../lib/daemon-log.ts";

const POLL_MS = 1000;
const MAX_LINES = 1000;

export function useDaemonLog(): DaemonLogLine[] {
  const [lines, setLines] = useState<DaemonLogLine[]>(() =>
    readDaemonLogTail(MAX_LINES)
  );

  useEffect(() => {
    const refresh = () => {
      const next = readDaemonLogTail(MAX_LINES);
      setLines((current) => (daemonLogLinesEqual(current, next) ? current : next));
    };
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, []);

  return lines;
}
