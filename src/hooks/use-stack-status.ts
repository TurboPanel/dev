import { useEffect, useState } from "react";
import { fetchStackStatus, type StackUnitStatus } from "@turbopanel/lib/stack-status.ts";

const POLL_MS = 3_000;

export function useStackStatus(enabled = true): StackUnitStatus[] {
  const [units, setUnits] = useState<StackUnitStatus[]>(() =>
    enabled ? fetchStackStatus() : []
  );

  useEffect(() => {
    if (!enabled) return;
    const tick = () => setUnits(fetchStackStatus());
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [enabled]);

  return units;
}
