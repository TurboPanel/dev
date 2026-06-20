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
  onDaemonAction,
  onDeveloperDaemonAction,
  onDaemonRestart,
  onSelectedServiceIndexChange,
  onProvisioningDone,
  onInstallFinished,
  onRestartDone,
  onPurgeDone,
  onRefreshServices,
  daemonOperation,
}: {
  activeArea: string;
  width: number;
  height: number;
  selectedServiceIndex: number;
  visibleServices: DevService[];
  daemonOperation?: DaemonOperation | null;
  onDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  onDeveloperDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  onDaemonRestart?: () => void;
  onSelectedServiceIndexChange?: (index: number) => void;
  onProvisioningDone?: () => void;
  onInstallFinished?: (success: boolean) => void;
  onRestartDone?: () => void;
  onPurgeDone?: () => void;
  onRefreshServices?: () => void;
}) {
  const daemon = visibleServices.find((service) => service.id === "daemon");

  switch (activeArea) {
    case "bootstrap":
      return (
        <ProvisionerPanel
          phase={daemonOperation === "dev-env" ? "dev-env" : "daemon"}
          width={width}
          height={height}
          onDone={onProvisioningDone!}
          onInstallFinished={onInstallFinished}
        />
      );
    case "developer":
      return (
        <DeveloperPanel
          width={width}
          height={height}
          daemonStatus={daemon?.status}
          daemonOperation={daemonOperation}
          onDaemonAction={onDeveloperDaemonAction}
          onPurgeDone={onPurgeDone}
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
          onDaemonRestart={onDaemonRestart}
          onSelectedIndexChange={onSelectedServiceIndexChange}
          onRestartDone={onRestartDone}
          onInstallFinished={onInstallFinished}
          onRefreshServices={onRefreshServices}
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
  onRestartDone,
  onPurgeDone,
  onDaemonAction,
  onDeveloperDaemonAction,
  onDaemonRestart,
  onSelectedServiceIndexChange,
  onRefreshServices,
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
  onProvisioningDone?: () => void;
  onInstallFinished?: (success: boolean) => void;
  onRestartDone?: () => void;
  onPurgeDone?: () => void;
  onDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  onDeveloperDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  onDaemonRestart?: () => void;
  onSelectedServiceIndexChange?: (index: number) => void;
  onRefreshServices?: () => void;
}) {
  const activeIndex = AREAS.findIndex((area) => area.id === activeArea);
  const menuActiveIndex = activeIndex >= 0 ? activeIndex : 0;
  const innerWidth = columns - 2;
  const contentHeight = rows - MENU_ROWS - STATUS_ROWS;
  const status = statusHints(
    activeArea,
    selectedServiceId,
    installFinished,
    daemonOperation,
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
          onRestartDone={onRestartDone}
          onPurgeDone={onPurgeDone}
          onDaemonAction={onDaemonAction}
          onDeveloperDaemonAction={onDeveloperDaemonAction}
          onDaemonRestart={onDaemonRestart}
          onSelectedServiceIndexChange={onSelectedServiceIndexChange}
          onRefreshServices={onRefreshServices}
        />
      </MainPanel>
    </Box>
  );
}
