import { useEffect, useState } from "react";
import { serviceLogLinesEqual } from "../lib/log-lines-equal.ts";
import {
  type ServiceLogLine,
  readServiceLogTail,
} from "../lib/service-log.ts";

const POLL_MS = 1000;
// Default tail window. Keep this small so initial render and scroll-back stay
// cheap; reverse infinite scroll can raise it on demand later.
const MAX_LINES = 100;

export function useServiceLog(serviceId: string | null): ServiceLogLine[] {
  const [lines, setLines] = useState<ServiceLogLine[]>(() =>
    serviceId ? readServiceLogTail(serviceId, MAX_LINES) : [],
  );

  useEffect(() => {
    if (!serviceId) {
      setLines([]);
      return;
    }

    setLines(readServiceLogTail(serviceId, MAX_LINES));

    const refresh = () => {
      const next = readServiceLogTail(serviceId, MAX_LINES);
      setLines((current) => (serviceLogLinesEqual(current, next) ? current : next));
    };
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [serviceId]);

  return lines;
}
