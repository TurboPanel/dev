import { useEffect, useState } from "react";

/** Shared animation tick for spinners; pass intervalMs <= 0 to disable updates. */
export function useSpinnerFrame(intervalMs = 120): number {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (intervalMs <= 0) {
      return;
    }

    const id = setInterval(() => {
      setFrame((value) => value + 1);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return frame;
}
