import React from "react";
import { Text } from "ink";
import { readInstanceRuntime } from "../lib/daemon-env.ts";

export const INSTANCE_RUNTIME_BADGE_WIDTH = 10;

export function InstanceRuntimeBadge() {
  const runtime = readInstanceRuntime();

  if (runtime === "workers") {
    return (
      <Text>
        ☁️ Workers
      </Text>
    );
  }

  return (
    <Text>
      🦕 Dino
    </Text>
  );
}
