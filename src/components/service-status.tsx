import type { DevServiceStatus } from "../dev-services.ts";
import type { DaemonOperation } from "../lib/spinners.ts";
import {
  BORDER_COLOR,
  MENU_BLUE,
  STATUS_PENDING,
  STATUS_RUNNING,
  STATUS_UNINSTALLED,
} from "../theme.ts";

export function serviceStatusColor(
  status: DevServiceStatus,
  options?: {
    operation?: DaemonOperation | null;
    busy?: boolean;
  },
): string {
  if (options?.busy || options?.operation) {
    return options?.operation === "purge" ? STATUS_UNINSTALLED : MENU_BLUE;
  }

  switch (status) {
    case "running":
      return STATUS_RUNNING;
    case "starting":
    case "pending":
      return STATUS_PENDING;
    case "failed":
    case "uninstalled":
      return STATUS_UNINSTALLED;
    case "stopped":
      return BORDER_COLOR;
  }
}
