import { useEffect, useState } from "react";

/** Whether the spinner hook should schedule interval ticks. */
export function isSpinnerIntervalEnabled(intervalMs: number): boolean {
  return intervalMs > 0;
}

/** Shared animation tick for spinners; pass intervalMs <= 0 to disable updates. */
export function useSpinnerFrame(intervalMs = 120): number {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isSpinnerIntervalEnabled(intervalMs)) {
      return;
    }

    const id = setInterval(() => {
      setFrame((value) => value + 1);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return frame;
}
