import React from "react";
import { Box } from "ink";
import { MainPanel } from "@turbopanel/components/main-panel.tsx";
import { MenuBar, type AreaTab } from "@turbopanel/components/menu-bar.tsx";
import { ServicesPanel } from "@turbopanel/components/services-panel.tsx";
import { statusHints } from "@turbopanel/components/status-bar.tsx";
import { DARK_GREY } from "./theme.ts";
import type { DevService } from "./dev-services.ts";
import type { DaemonActionId } from "./lib/daemon-actions.ts";
import type { DaemonOperation } from "./lib/spinners.ts";

export const AREAS: AreaTab[] = [
  { id: "services", label: "Services", emoji: "⚙" },
  { id: "developer", label: "Developer", emoji: "💻" },
];

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
  daemonOperation,
  installFinished,
  onDaemonOperationDone,
  onInstallFinished,
  onPurgeDone,
}: {
  activeArea: AreaTab;
  width: number;
  height: number;
  selectedServiceIndex: number;
  visibleServices: DevService[];
  openServiceId?: string | null;
  onOpenService?: (serviceId: string) => void;
  onCloseService?: () => void;
  onDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  onSelectedServiceIndexChange?: (index: number) => void;
  daemonOperation?: DaemonOperation | null;
  installFinished?: boolean;
  onDaemonOperationDone?: () => void;
  onInstallFinished?: (success: boolean) => void;
  onPurgeDone?: () => void;
}) {
  switch (activeArea.id) {
    case "services":
      return (
        <ServicesPanel
          width={width}
          height={height}
          services={visibleServices}
          selectedIndex={selectedServiceIndex}
          openServiceId={openServiceId}
          daemonOperation={daemonOperation}
          installFinished={installFinished}
          onDaemonOperationDone={onDaemonOperationDone}
          onInstallFinished={onInstallFinished}
          onPurgeDone={onPurgeDone}
          onOpenService={onOpenService}
          onCloseService={onCloseService}
          onDaemonAction={onDaemonAction}
          onSelectedIndexChange={onSelectedServiceIndexChange}
        />
      );
    default:
      return null;
  }
}

export function AppView({
  activeIndex,
  columns,
  rows,
  selectedServiceIndex,
  visibleServices,
  openServiceId,
  daemonOperation,
  installFinished,
  onDaemonOperationDone,
  onInstallFinished,
  onPurgeDone,
  onOpenService,
  onCloseService,
  onDaemonAction,
  onSelectedServiceIndexChange,
}: {
  activeIndex: number;
  columns: number;
  rows: number;
  selectedServiceIndex: number;
  visibleServices: DevService[];
  openServiceId?: string | null;
  daemonOperation?: DaemonOperation | null;
  installFinished?: boolean;
  onDaemonOperationDone?: () => void;
  onInstallFinished?: (success: boolean) => void;
  onPurgeDone?: () => void;
  onOpenService?: (serviceId: string) => void;
  onCloseService?: () => void;
  onDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  onSelectedServiceIndexChange?: (index: number) => void;
}) {
  const activeArea = AREAS[activeIndex] ?? AREAS[0]!;
  const innerWidth = columns - 2;
  const contentHeight = rows - MENU_ROWS - STATUS_ROWS;
  const status = daemonOperation === "install"
    ? "Installing daemon · Ctrl-C exit"
    : daemonOperation === "purge"
    ? "Purging daemon · Ctrl-C exit"
    : daemonOperation === "restart"
    ? "Restarting daemon · Ctrl-C exit"
    : statusHints(activeArea.id, openServiceId);

  return (
    <Box
      flexDirection="column"
      width={columns}
      height={rows}
      backgroundColor={DARK_GREY}
    >
      <MenuBar areas={AREAS} activeIndex={activeIndex} columns={columns} />

      <MainPanel width={columns} status={status}>
        <MainContent
          activeArea={activeArea}
          width={innerWidth}
          height={contentHeight}
          selectedServiceIndex={selectedServiceIndex}
          visibleServices={visibleServices}
          openServiceId={openServiceId}
          daemonOperation={daemonOperation}
          installFinished={installFinished}
          onDaemonOperationDone={onDaemonOperationDone}
          onInstallFinished={onInstallFinished}
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
