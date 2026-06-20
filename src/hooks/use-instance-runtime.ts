import { useEffect, useState } from "react";
import { readInstanceRuntime } from "../lib/daemon-env.ts";

export function useInstanceRuntime(): "deno" | "workers" {
  const [runtime, setRuntime] = useState(readInstanceRuntime);

  useEffect(() => {
    const refresh = () => {
      const next = readInstanceRuntime();
      setRuntime((current) => (current === next ? current : next));
    };

    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, []);

  return runtime;
}
