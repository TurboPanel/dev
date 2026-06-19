import { useEffect, useState } from "react";
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
    const refresh = () => setLines(readDaemonLogTail(MAX_LINES));
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, []);

  return lines;
}
