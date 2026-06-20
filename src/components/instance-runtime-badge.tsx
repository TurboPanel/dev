import React from "react";
import { Text } from "ink";
import { useInstanceRuntime } from "../hooks/use-instance-runtime.ts";

export function InstanceRuntimeBadge() {
  const runtime = useInstanceRuntime();

  if (runtime === "workers") {
    return (
      <Text wrap="truncate">
        ☁️ Worker
      </Text>
    );
  }

  return (
    <Text wrap="truncate">
      🦕 Deno
    </Text>
  );
}
