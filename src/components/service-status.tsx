import React from "react";
import { Text } from "ink";
import type { DevServiceStatus } from "../dev-services.ts";
import type { DaemonOperation } from "../lib/spinners.ts";
import { BORDER_COLOR, STATUS_PENDING, STATUS_RUNNING, STATUS_UNINSTALLED } from "../theme.ts";
import { OperationSpinner } from "./operation-spinner.tsx";

export function ServiceStatusIndicator({
  status,
  operation,
}: {
  status: DevServiceStatus;
  operation?: DaemonOperation | null;
}) {
  if (operation) {
    return <OperationSpinner operation={operation} />;
  }

  if (status === "running") {
    return <Text color={STATUS_RUNNING}>✓</Text>;
  }

  if (status === "starting") {
    return <Text color={STATUS_PENDING}>•</Text>;
  }

  if (status === "uninstalled") {
    return <Text color={STATUS_UNINSTALLED}>✗</Text>;
  }

  if (status === "pending") {
    return <Text color={STATUS_PENDING}>✗</Text>;
  }

  if (status === "failed") {
    return <Text color={STATUS_UNINSTALLED}>✗</Text>;
  }

  return <Text color={BORDER_COLOR}>○</Text>;
}
