import React from "react";
import { Text } from "ink";
import { useInstanceRuntime } from "../hooks/use-instance-runtime.ts";
import {
  stackBadgeLabel,
  type StackBadgeRuntime,
} from "../lib/stack-versions.ts";

export function InstanceRuntimeBadge({
  runtime: runtimeOverride,
  serviceId,
}: {
  runtime?: StackBadgeRuntime;
  serviceId?: string;
} = {}) {
  const instanceRuntime = useInstanceRuntime();
  const runtime = runtimeOverride ?? instanceRuntime;
  const label = stackBadgeLabel(runtime, { serviceId, instanceRuntime });

  return (
    <Text wrap="truncate">
      {label}
    </Text>
  );
}
