import React, { useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { ScrollList } from "ink-scroll-list";
import type { DevService } from "../dev-services.ts";
import {
  canRestartDaemon,
  daemonMenuActions,
  type DaemonActionId,
} from "../lib/daemon-actions.ts";
import type { DaemonOperation } from "../lib/spinners.ts";
import { BORDER_COLOR, LIST_FOCUS_BG, LIST_FOCUS_FG, LIST_OPEN_BG, LIST_OPEN_FG } from "../theme.ts";
import { DaemonDetailPanel } from "./daemon-detail-panel.tsx";
import { RestartDaemonModal } from "./restart-daemon-modal.tsx";
import { ServiceDetailPanel } from "./service-detail-panel.tsx";
import { ServiceStatusIndicator } from "./service-status.tsx";

const LIST_PADDING_RIGHT = 1;
const LIST_GAP = 1;
const STATUS_WIDTH = 1;
const LIST_LEADING_WIDTH = STATUS_WIDTH + LIST_GAP;
const LIST_TRAILING_WIDTH = LIST_PADDING_RIGHT;
const SERVICE_LIST_BORDER_COLUMNS = 2;
const MIN_DETAIL_WIDTH = 28;

export function serviceListWidth(services: DevService[]): number {
  const longestLabel = services.reduce(
    (max, service) => Math.max(max, service.label.length),
    0,
  );

  return (
    LIST_LEADING_WIDTH +
    longestLabel +
    LIST_TRAILING_WIDTH +
    SERVICE_LIST_BORDER_COLUMNS
  );
}

function resolvePaneWidths(
  width: number,
  services: DevService[],
): { leftWidth: number; detailWidth: number } {
  const preferredLeft = serviceListWidth(services);
  const leftWidth = Math.min(preferredLeft, Math.max(8, width - MIN_DETAIL_WIDTH));
  return {
    leftWidth,
    detailWidth: Math.max(0, width - leftWidth),
  };
}

export function ServicesPanel({
  width,
  height,
  services,
  selectedIndex,
  openServiceId,
  onOpenService,
  onCloseService,
  onDaemonAction,
  onDaemonRestart,
  onSelectedIndexChange,
  onRestartDone,
  onInstallFinished,
  onRefreshServices,
  daemonOperation,
}: {
  width: number;
  height: number;
  services: DevService[];
  selectedIndex: number;
  openServiceId?: string | null;
  daemonOperation?: DaemonOperation | null;
  onOpenService?: (serviceId: string) => void;
  onCloseService?: () => void;
  onDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  onDaemonRestart?: () => void;
  onSelectedIndexChange?: (index: number) => void;
  onRestartDone?: () => void;
  onInstallFinished?: (success: boolean) => void;
  onRefreshServices?: () => void;
}) {
  const { leftWidth, detailWidth } = resolvePaneWidths(width, services);
  const selectedService = services[selectedIndex] ?? null;
  const openService = openServiceId
    ? services.find((service) => service.id === openServiceId) ?? null
    : null;
  const detailService = openService ?? selectedService;
  const inDetail = openServiceId !== null;
  const logFocused = inDetail && openService?.id !== "daemon";
  const openServiceIndex = openServiceId
    ? services.findIndex((service) => service.id === openServiceId)
    : -1;
  const listScrollIndex = inDetail && openServiceIndex >= 0
    ? openServiceIndex
    : selectedIndex;
  const daemonActions = useMemo(
    () => (detailService?.id === "daemon" ? daemonMenuActions(detailService.status) : []),
    [detailService],
  );

  useInput((_input, key) => {
    if (daemonOperation) {
      return;
    }

    if (inDetail && openService?.id !== "daemon") {
      if (key.escape && onCloseService) {
        onCloseService();
      }
      return;
    }

    if (inDetail && openService?.id === "daemon") {
      if (key.escape && onCloseService) {
        onCloseService();
        return;
      }
      if (
        (_input === "r" || _input === "R") &&
        canRestartDaemon() &&
        onDaemonRestart
      ) {
        onDaemonRestart();
      }
      return;
    }

    const lastServiceIndex = services.length - 1;
    if (key.upArrow && onSelectedIndexChange) {
      onSelectedIndexChange(Math.max(0, selectedIndex - 1));
    }
    if (key.downArrow && onSelectedIndexChange) {
      onSelectedIndexChange(Math.min(lastServiceIndex, selectedIndex + 1));
    }

    if (key.return && onOpenService) {
      const service = services[selectedIndex];
      if (service) {
        onOpenService(service.id);
      }
    }
  });

  return (
    <Box flexDirection="row" flexGrow={1} width={width} height={height}>
      <Box
        width={leftWidth}
        height={height}
        flexShrink={0}
        borderStyle="single"
        borderColor={BORDER_COLOR}
        borderRight
        borderTop={false}
        borderBottom={false}
        borderLeft={false}
      >
        <ScrollList height={height} selectedIndex={listScrollIndex}>
          {services.map((service, index) => {
            const isOpen = service.id === openServiceId;
            const focused = !inDetail && index === selectedIndex;
            const opened = inDetail && isOpen;
            const dimmed = inDetail && !isOpen;
            const previewing = !inDetail && index === selectedIndex;
            const rowBackground = opened
              ? LIST_OPEN_BG
              : focused
              ? LIST_FOCUS_BG
              : undefined;
            const rowForeground = opened
              ? LIST_OPEN_FG
              : focused
              ? LIST_FOCUS_FG
              : undefined;
            const daemonOp =
              service.id === "daemon" &&
              daemonOperation &&
              daemonOperation !== "restart"
                ? daemonOperation
                : null;
            return (
              <Box
                key={service.id}
                width={Math.max(1, leftWidth - 2)}
                backgroundColor={rowBackground}
                flexDirection="row"
                gap={LIST_GAP}
                paddingRight={LIST_PADDING_RIGHT}
              >
                <ServiceStatusIndicator
                  status={service.status}
                  dimmed={dimmed && !previewing}
                  highlighted={opened || previewing}
                  operation={daemonOp}
                />
                <Text
                  color={rowForeground}
                  bold={focused || opened || previewing}
                  dimColor={dimmed && !previewing}
                >
                  {service.label}
                </Text>
              </Box>
            );
          })}
        </ScrollList>
      </Box>
      {detailService?.id === "daemon" && detailWidth > 0 && (
        <Box width={detailWidth} height={height} position="relative">
          <DaemonDetailPanel
            service={detailService}
            actions={daemonActions}
            width={detailWidth}
            height={height}
            onDaemonAction={onDaemonAction}
            suspended={daemonOperation === "restart"}
          />
          {daemonOperation === "restart" && onRestartDone && (
            <RestartDaemonModal
              width={detailWidth}
              height={height}
              onDone={onRestartDone}
              onReady={onInstallFinished}
              onRefresh={onRefreshServices}
            />
          )}
        </Box>
      )}
      {detailService && detailService.id !== "daemon" && detailWidth > 0 && !daemonOperation && (
        <ServiceDetailPanel
          service={detailService}
          width={detailWidth}
          height={height}
          focused={logFocused}
        />
      )}
    </Box>
  );
}
