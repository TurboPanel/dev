import { useCallback, useEffect, useRef, useState } from "react";
import { getVisibleServices, type DevService } from "../dev-services.ts";

export function servicesEqual(current: DevService[], next: DevService[]): boolean {
  if (current.length !== next.length) {
    return false;
  }

  return current.every((service, index) => {
    const other = next[index]!;
    return (
      service.id === other.id &&
      service.label === other.label &&
      service.status === other.status
    );
  });
}

/** Status polling is deliberately slow — systemctl/docker fan-out is ~100–180ms sync. */
const STATUS_POLL_MS = 15_000;

export function useVisibleServices(): {
  services: DevService[];
  refresh: () => void;
} {
  const [services, setServices] = useState(() => getVisibleServices());
  const busyRef = useRef(false);

  const refresh = useCallback(() => {
    if (busyRef.current) {
      return;
    }
    // Defer past the current input/frame so arrow keys stay responsive.
    setTimeout(() => {
      if (busyRef.current) {
        return;
      }
      busyRef.current = true;
      try {
        const next = getVisibleServices();
        setServices((current) => (servicesEqual(current, next) ? current : next));
      } finally {
        busyRef.current = false;
      }
    }, 0);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { services, refresh };
}
