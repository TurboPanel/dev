import { useEffect, useState } from "react";
import {
  type ServiceLogLine,
  readServiceLogTail,
} from "../lib/service-log.ts";

const POLL_MS = 1000;
const MAX_LINES = 1000;

export function useServiceLog(serviceId: string | null): ServiceLogLine[] {
  const [lines, setLines] = useState<ServiceLogLine[]>(() =>
    serviceId ? readServiceLogTail(serviceId, MAX_LINES) : [],
  );

  useEffect(() => {
    if (!serviceId) {
      setLines([]);
      return;
    }

    const refresh = () => setLines(readServiceLogTail(serviceId, MAX_LINES));
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [serviceId]);

  return lines;
}
