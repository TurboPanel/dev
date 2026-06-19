import React from "react";
import { Box } from "ink";
import { MainPanel } from "@turbopanel/components/main-panel.tsx";
import { MenuBar, type AreaTab } from "@turbopanel/components/menu-bar.tsx";
import { DeveloperPanel } from "@turbopanel/components/developer-panel.tsx";
import { ProvisionerPanel } from "@turbopanel/components/provisioner-panel.tsx";
import { ServicesPanel } from "@turbopanel/components/services-panel.tsx";
import { statusHints } from "@turbopanel/components/status-bar.tsx";
import { DARK_GREY } from "./theme.ts";
import type { DevService } from "./dev-services.ts";
import type { DaemonActionId } from "./lib/daemon-actions.ts";
import type { DaemonOperation } from "./lib/spinners.ts";

export const AREAS: AreaTab[] = [
  { id: "developer", label: "Developer", emoji: "💻" },
  { id: "services", label: "Services", emoji: "⚙" },
];

export const PROVISIONER_AREA: AreaTab = {
  id: "provisioner",
  label: "Provisioner",
  emoji: "🔧",
};

const MENU_ROWS = 2;
const STATUS_ROWS = 1;

function MainContent({
  activeArea,
  width,
  height,
  selectedServiceIndex,
  visibleServices,
  openServiceId,
  onOpenService,
  onCloseService,
  onDaemonAction,
  onSelectedServiceIndexChange,
  onProvisioningDone,
  onInstallFinished,
  onRestartDone,
  onPurgeDone,
  daemonOperation,
}: {
  activeArea: string;
  width: number;
  height: number;
  selectedServiceIndex: number;
  visibleServices: DevService[];
  openServiceId?: string | null;
  daemonOperation?: DaemonOperation | null;
  onOpenService?: (serviceId: string) => void;
  onCloseService?: () => void;
  onDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  onSelectedServiceIndexChange?: (index: number) => void;
  onProvisioningDone?: () => void;
  onInstallFinished?: (success: boolean) => void;
  onRestartDone?: () => void;
  onPurgeDone?: () => void;
}) {
  switch (activeArea) {
    case "provisioner":
      return (
        <ProvisionerPanel
          width={width}
          height={height}
          onDone={onProvisioningDone!}
          onInstallFinished={onInstallFinished}
        />
      );
    case "developer":
      return <DeveloperPanel />;
    case "services":
      return (
        <ServicesPanel
          width={width}
          height={height}
          services={visibleServices}
          selectedIndex={selectedServiceIndex}
          openServiceId={openServiceId}
          daemonOperation={daemonOperation}
          onOpenService={onOpenService}
          onCloseService={onCloseService}
          onDaemonAction={onDaemonAction}
          onSelectedIndexChange={onSelectedServiceIndexChange}
          onRestartDone={onRestartDone}
          onPurgeDone={onPurgeDone}
          onInstallFinished={onInstallFinished}
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
  visibleServices,
  openServiceId,
  daemonOperation,
  onProvisioningDone,
  onInstallFinished,
  onRestartDone,
  onPurgeDone,
  onOpenService,
  onCloseService,
  onDaemonAction,
  onSelectedServiceIndexChange,
}: {
  activeArea: string;
  provisioning: boolean;
  installFinished?: boolean;
  columns: number;
  rows: number;
  selectedServiceIndex: number;
  visibleServices: DevService[];
  openServiceId?: string | null;
  daemonOperation?: DaemonOperation | null;
  onProvisioningDone?: () => void;
  onInstallFinished?: (success: boolean) => void;
  onRestartDone?: () => void;
  onPurgeDone?: () => void;
  onOpenService?: (serviceId: string) => void;
  onCloseService?: () => void;
  onDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  onSelectedServiceIndexChange?: (index: number) => void;
}) {
  const activeIndex = AREAS.findIndex((area) => area.id === activeArea);
  const menuActiveIndex = activeIndex >= 0 ? activeIndex : 0;
  const innerWidth = columns - 2;
  const contentHeight = rows - MENU_ROWS - STATUS_ROWS;
  const status = statusHints(activeArea, openServiceId, installFinished);

  return (
    <Box
      flexDirection="column"
      width={columns}
      height={rows}
      backgroundColor={DARK_GREY}
    >
      <MenuBar
        areas={AREAS}
        activeIndex={menuActiveIndex}
        columns={columns}
        provisioning={provisioning}
        provisionerArea={PROVISIONER_AREA}
      />

      <MainPanel width={columns} status={status}>
        <MainContent
          activeArea={activeArea}
          width={innerWidth}
          height={contentHeight}
          selectedServiceIndex={selectedServiceIndex}
          visibleServices={visibleServices}
          openServiceId={openServiceId}
          daemonOperation={daemonOperation}
          onProvisioningDone={onProvisioningDone}
          onInstallFinished={onInstallFinished}
          onRestartDone={onRestartDone}
          onPurgeDone={onPurgeDone}
          onOpenService={onOpenService}
          onCloseService={onCloseService}
          onDaemonAction={onDaemonAction}
          onSelectedServiceIndexChange={onSelectedServiceIndexChange}
        />
      </MainPanel>
    </Box>
  );
}
