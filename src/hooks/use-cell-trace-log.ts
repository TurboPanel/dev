import { useEffect, useState } from "react";
import { serviceLogLinesEqual } from "../lib/log-lines-equal.ts";
import { readCellTraceLogTail } from "../lib/cell-trace-log.ts";
import {
  type ServiceLogByteFloor,
  type ServiceLogLine,
} from "../lib/service-log.ts";

const POLL_MS = 1000;
const MAX_LINES = 100;

export function useCellTraceLog(
  byteFloor?: ServiceLogByteFloor | null,
): ServiceLogLine[] {
  const [lines, setLines] = useState<ServiceLogLine[]>(() =>
    readCellTraceLogTail(MAX_LINES, byteFloor),
  );

  useEffect(() => {
    setLines(readCellTraceLogTail(MAX_LINES, byteFloor));

    const refresh = () => {
      const next = readCellTraceLogTail(MAX_LINES, byteFloor);
      setLines((current) => (serviceLogLinesEqual(current, next) ? current : next));
    };
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [byteFloor]);

  return lines;
}
