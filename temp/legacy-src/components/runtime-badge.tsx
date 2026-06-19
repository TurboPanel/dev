import React from "react";
import { Text } from "ink";

export type InstanceRuntime = "deno" | "workers";

export function RuntimeBadge({ runtime }: { runtime: InstanceRuntime }) {
  if (runtime === "workers") {
    return <Text color="#FFA500">Workers</Text>;
  }

  return <Text color="green">🦕 Deno</Text>;
}
