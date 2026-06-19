import React from "react";
import { Text } from "ink";
import type { DevServiceStatus } from "../dev-services.ts";
import type { DaemonOperation } from "../lib/spinners.ts";
import { STATUS_PENDING, STATUS_RUNNING, STATUS_UNINSTALLED } from "../theme.ts";
import { OperationSpinner } from "./operation-spinner.tsx";

export function ServiceStatusIndicator({
  status,
  dimmed = false,
  highlighted = false,
  operation,
}: {
  status: DevServiceStatus;
  dimmed?: boolean;
  highlighted?: boolean;
  operation?: DaemonOperation | null;
}) {
  const muted = dimmed && !highlighted;

  if (operation) {
    return (
      <OperationSpinner
        operation={operation}
        dimmed={muted}
        highlighted={highlighted}
      />
    );
  }

  if (status === "running") {
    return (
      <Text color={muted ? undefined : STATUS_RUNNING} dimColor={muted} bold={highlighted}>
        ✓
      </Text>
    );
  }

  if (status === "starting") {
    return (
      <Text color={muted ? undefined : STATUS_PENDING} dimColor={muted} bold={highlighted}>
        •
      </Text>
    );
  }

  if (status === "uninstalled") {
    return (
      <Text color={muted ? undefined : STATUS_UNINSTALLED} dimColor={muted} bold={highlighted}>
        ✗
      </Text>
    );
  }

  if (status === "pending") {
    return (
      <Text color={muted ? undefined : STATUS_UNINSTALLED} dimColor={muted} bold={highlighted}>
        ✗
      </Text>
    );
  }

  return <Text dimColor={!highlighted} bold={highlighted}>○</Text>;
}
