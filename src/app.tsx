import React from "react";
import { Box } from "ink";
import { MainPanel } from "@turbopanel/components/main-panel.tsx";
import { MenuBar, type AreaTab } from "@turbopanel/components/menu-bar.tsx";
import { DeveloperPanel } from "@turbopanel/components/developer-panel.tsx";
import { ProvisionerPanel } from "@turbopanel/components/provisioner-panel.tsx";
import { ServicesPanel } from "@turbopanel/components/services-panel.tsx";
import { statusHints } from "@turbopanel/components/status-bar.tsx";
import type { DevService } from "./dev-services.ts";
import type { DaemonActionId } from "./lib/daemon-actions.ts";
import type { ServiceActionId } from "./lib/service-actions.ts";
import type { PendingRestart, ServiceOperation, DeveloperView } from "./hooks/use-console-app.ts";
import type { DevEnvConvergeState } from "./hooks/use-dev-env-converge.ts";
import type { DaemonLogByteFloor } from "./lib/daemon-log.ts";
import type { ServiceLogByteFloor } from "./lib/service-log.ts";
import type { ConsoleLogLine } from "./lib/service-restart.ts";
import type { DaemonOperation } from "./lib/spinners.ts";

export const AREAS: AreaTab[] = [
  { id: "services", label: "Services", emoji: "📦" },
  { id: "developer", label: "Developer", emoji: "💻" },
];

export const BOOTSTRAP_AREA: AreaTab = {
  id: "bootstrap",
  label: "Bootstrap",
  emoji: "🚀",
};

const MENU_ROWS = 2;
const STATUS_ROWS = 1;

function MainContent({
  activeArea,
  width,
  height,
  selectedServiceIndex,
  visibleServices,
  onProvisioningDone,
  onInstallFinished,
  onDaemonInstallDone,
  onPurgeDone,
  onRefreshServices,
  daemonOperation,
  serviceOperation,
  onServiceAction,
  onDaemonAction,
  onDeveloperDaemonAction,
  onSelectedServiceIndexChange,
  pendingRestart,
  restartInProgress,
  restartOverlayServiceId,
  restartLogOverlay,
  logFollowResetKey,
  daemonLogByteFloor,
  instanceLogByteFloor,
  onConfirmRestart,
  onCancelRestart,
  devEnvConverge,
  onDismissDevEnvConvergeError,
  developerView,
  onCloseCellTraceView,
}: {
  activeArea: string;
  width: number;
  height: number;
  selectedServiceIndex: number;
  visibleServices: DevService[];
  daemonOperation?: DaemonOperation | null;
  serviceOperation?: ServiceOperation | null;
  onServiceAction?: (serviceId: string, action: ServiceActionId) => void | Promise<void>;
  onDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  onDeveloperDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  onSelectedServiceIndexChange?: (index: number) => void;
  onProvisioningDone?: () => void;
  onInstallFinished?: (success: boolean) => void;
  onDaemonInstallDone?: () => void;
  onPurgeDone?: () => void;
  onRefreshServices?: () => void;
  pendingRestart?: PendingRestart | null;
  restartInProgress?: string | null;
  restartOverlayServiceId?: string | null;
  restartLogOverlay?: ConsoleLogLine[];
  logFollowResetKey?: number;
  daemonLogByteFloor?: DaemonLogByteFloor | null;
  instanceLogByteFloor?: ServiceLogByteFloor | null;
  onConfirmRestart?: () => void;
  onCancelRestart?: () => void;
  devEnvConverge?: DevEnvConvergeState | null;
  onDismissDevEnvConvergeError?: () => void;
  developerView?: DeveloperView;
  onCloseCellTraceView?: () => void;
}) {
  const daemon = visibleServices.find((service) => service.id === "daemon");

  switch (activeArea) {
    case "bootstrap":
      return (
        <ProvisionerPanel
          phase={
            daemonOperation === "dev-env"
              ? "dev-env"
              : daemonOperation === "reset-dev-env"
                ? "reset-dev-env"
                : daemonOperation === "reset-dev-db"
                  ? "reset-dev-db"
                  : daemonOperation === "sync-dev-build"
                    ? "sync-dev-build"
                    : "daemon"
          }
          width={width}
          height={height}
          onDone={onProvisioningDone!}
          onInstallFinished={onInstallFinished}
          onDaemonInstallDone={onDaemonInstallDone}
        />
      );
    case "developer":
      return (
        <DeveloperPanel
          width={width}
          height={height}
          daemonStatus={daemon?.status}
          daemonOperation={daemonOperation}
          developerView={developerView}
          onCloseCellTraceView={onCloseCellTraceView}
          onDaemonAction={onDeveloperDaemonAction}
          onPurgeDone={onPurgeDone}
          onRefreshServices={onRefreshServices}
          restartInProgress={restartInProgress}
          restartOverlayServiceId={restartOverlayServiceId}
          restartLogOverlay={restartLogOverlay}
          logFollowResetKey={logFollowResetKey}
          instanceLogByteFloor={instanceLogByteFloor}
        />
      );
    case "services":
      return (
        <ServicesPanel
          width={width}
          height={height}
          services={visibleServices}
          selectedIndex={selectedServiceIndex}
          daemonOperation={daemonOperation}
          onDaemonAction={onDaemonAction}
          onSelectedIndexChange={onSelectedServiceIndexChange}
          onRefreshServices={onRefreshServices}
          serviceOperation={serviceOperation}
          onServiceAction={onServiceAction}
          pendingRestart={pendingRestart}
          restartInProgress={restartInProgress}
          restartOverlayServiceId={restartOverlayServiceId}
          restartLogOverlay={restartLogOverlay}
          logFollowResetKey={logFollowResetKey}
          daemonLogByteFloor={daemonLogByteFloor}
          instanceLogByteFloor={instanceLogByteFloor}
          onConfirmRestart={onConfirmRestart}
          onCancelRestart={onCancelRestart}
          devEnvConverge={devEnvConverge}
          onDismissDevEnvConvergeError={onDismissDevEnvConvergeError}
        />
      );
    default:
      return null;
  }
}

export function AppView({
  activeArea,
  provisioning,
  installFinished,
  columns,
  rows,
  selectedServiceIndex,
  selectedServiceId,
  visibleServices,
  daemonOperation,
  onProvisioningDone,
  onInstallFinished,
  onDaemonInstallDone,
  onPurgeDone,
  onDaemonAction,
  onDeveloperDaemonAction,
  onSelectedServiceIndexChange,
  onRefreshServices,
  serviceOperation,
  onServiceAction,
  pendingRestart,
  restartInProgress,
  restartOverlayServiceId,
  restartLogOverlay,
  logFollowResetKey,
  daemonLogByteFloor,
  instanceLogByteFloor,
  onConfirmRestart,
  onCancelRestart,
  devEnvConverge,
  onDismissDevEnvConvergeError,
  developerView,
  onCloseCellTraceView,
}: {
  activeArea: string;
  provisioning: boolean;
  installFinished?: boolean;
  columns: number;
  rows: number;
  selectedServiceIndex: number;
  selectedServiceId?: string | null;
  visibleServices: DevService[];
  daemonOperation?: DaemonOperation | null;
  serviceOperation?: ServiceOperation | null;
  onServiceAction?: (serviceId: string, action: ServiceActionId) => void | Promise<void>;
  onProvisioningDone?: () => void;
  onInstallFinished?: (success: boolean) => void;
  onDaemonInstallDone?: () => void;
  onPurgeDone?: () => void;
  onDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  onDeveloperDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  onSelectedServiceIndexChange?: (index: number) => void;
  onRefreshServices?: () => void;
  pendingRestart?: PendingRestart | null;
  restartInProgress?: string | null;
  restartOverlayServiceId?: string | null;
  restartLogOverlay?: ConsoleLogLine[];
  logFollowResetKey?: number;
  daemonLogByteFloor?: DaemonLogByteFloor | null;
  instanceLogByteFloor?: ServiceLogByteFloor | null;
  onConfirmRestart?: () => void;
  onCancelRestart?: () => void;
  devEnvConverge?: DevEnvConvergeState | null;
  onDismissDevEnvConvergeError?: () => void;
  developerView?: DeveloperView;
  onCloseCellTraceView?: () => void;
}) {
  const activeIndex = AREAS.findIndex((area) => area.id === activeArea);
  const menuActiveIndex = activeIndex >= 0 ? activeIndex : 0;
  const innerWidth = columns - 2;
  const contentHeight = rows - MENU_ROWS - STATUS_ROWS;
  const status = statusHints(
    activeArea,
    selectedServiceId,
    installFinished,
    pendingRestart,
    restartInProgress,
    daemonOperation === "dev-env" || Boolean(devEnvConverge?.active),
    developerView,
  );

  return (
    <Box
      flexDirection="column"
      width={columns}
      height={rows}
    >
      <MenuBar
        areas={AREAS}
        activeIndex={menuActiveIndex}
        columns={columns}
        provisioning={provisioning}
        bootstrapArea={BOOTSTRAP_AREA}
      />

      <MainPanel width={columns} status={status}>
        <MainContent
          activeArea={activeArea}
          width={innerWidth}
          height={contentHeight}
          selectedServiceIndex={selectedServiceIndex}
          visibleServices={visibleServices}
          daemonOperation={daemonOperation}
          onProvisioningDone={onProvisioningDone}
          onInstallFinished={onInstallFinished}
          onDaemonInstallDone={onDaemonInstallDone}
          onPurgeDone={onPurgeDone}
          onDaemonAction={onDaemonAction}
          onDeveloperDaemonAction={onDeveloperDaemonAction}
          onSelectedServiceIndexChange={onSelectedServiceIndexChange}
          onRefreshServices={onRefreshServices}
          serviceOperation={serviceOperation}
          onServiceAction={onServiceAction}
          pendingRestart={pendingRestart}
          restartInProgress={restartInProgress}
          restartOverlayServiceId={restartOverlayServiceId}
          restartLogOverlay={restartLogOverlay}
          logFollowResetKey={logFollowResetKey}
          daemonLogByteFloor={daemonLogByteFloor}
          instanceLogByteFloor={instanceLogByteFloor}
          onConfirmRestart={onConfirmRestart}
          onCancelRestart={onCancelRestart}
          devEnvConverge={devEnvConverge}
          onDismissDevEnvConvergeError={onDismissDevEnvConvergeError}
          developerView={developerView}
          onCloseCellTraceView={onCloseCellTraceView}
        />
      </MainPanel>
    </Box>
  );
}
