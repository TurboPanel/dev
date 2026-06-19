import { useCallback, useEffect, useState } from "react";
import { getVisibleServices, type DevService } from "../dev-services.ts";

function servicesEqual(current: DevService[], next: DevService[]): boolean {
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

export function useVisibleServices(): {
  services: DevService[];
  refresh: () => void;
} {
  const [services, setServices] = useState(() => getVisibleServices());

  const refresh = useCallback(() => {
    const next = getVisibleServices();
    setServices((current) => (servicesEqual(current, next) ? current : next));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  return { services, refresh };
}
