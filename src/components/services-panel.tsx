import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { ScrollList } from "ink-scroll-list";
import type { DevService } from "../dev-services.ts";
import {
  canRestartDaemon,
  daemonMenuActions,
  type DaemonActionId,
} from "../lib/daemon-actions.ts";
import type { DaemonOperation } from "../lib/spinners.ts";
import { BORDER_COLOR } from "../theme.ts";
import { DaemonDetailPanel } from "./daemon-detail-panel.tsx";
import { RestartDaemonModal } from "./restart-daemon-modal.tsx";
import { ServiceDetailPanel } from "./service-detail-panel.tsx";
import { ServiceStatusIndicator } from "./service-status.tsx";

const ARROW_WIDTH = 1;
const STATUS_WIDTH = 1;
const LIST_PADDING_RIGHT = 1;
const LIST_LEADING_WIDTH = ARROW_WIDTH;
const LIST_TRAILING_WIDTH = STATUS_WIDTH + LIST_PADDING_RIGHT;
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
  daemonOperation?: DaemonOperation | null;
  onDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  onDaemonRestart?: () => void;
  onSelectedIndexChange?: (index: number) => void;
  onRestartDone?: () => void;
  onInstallFinished?: (success: boolean) => void;
  onRefreshServices?: () => void;
}) {
  const { leftWidth, detailWidth } = resolvePaneWidths(width, services);
  const selectedService = services[selectedIndex] ?? null;
  const [logFocused, setLogFocused] = useState(false);
  const daemonActions = useMemo(
    () => (selectedService?.id === "daemon" ? daemonMenuActions(selectedService.status) : []),
    [selectedService],
  );

  useEffect(() => {
    setLogFocused(false);
  }, [selectedIndex]);

  useInput((_input, key) => {
    if (daemonOperation === "restart") {
      return;
    }

    if (key.tab) {
      setLogFocused((focused) => !focused);
      return;
    }

    if (logFocused) {
      return;
    }

    const lastServiceIndex = services.length - 1;
    if (key.upArrow && onSelectedIndexChange) {
      onSelectedIndexChange(Math.max(0, selectedIndex - 1));
      return;
    }
    if (key.downArrow && onSelectedIndexChange) {
      onSelectedIndexChange(Math.min(lastServiceIndex, selectedIndex + 1));
      return;
    }

    if (
      selectedService?.id === "daemon" &&
      (_input === "r" || _input === "R") &&
      canRestartDaemon() &&
      onDaemonRestart
    ) {
      onDaemonRestart();
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
        <ScrollList height={height} selectedIndex={selectedIndex}>
          {services.map((service, index) => {
            const focused = index === selectedIndex;
            return (
              <Box
                key={service.id}
                width={Math.max(1, leftWidth - 1)}
                flexDirection="row"
                justifyContent="space-between"
                paddingRight={LIST_PADDING_RIGHT}
              >
                <Text dimColor={!focused} wrap="truncate">
                  {focused ? "›" : " "}{service.label}
                </Text>
                <ServiceStatusIndicator
                  status={service.status}
                  operation={
                    service.id === "daemon" &&
                    daemonOperation &&
                    daemonOperation !== "restart"
                      ? daemonOperation
                      : null
                  }
                />
              </Box>
            );
          })}
        </ScrollList>
      </Box>
      {selectedService?.id === "daemon" && detailWidth > 0 && (
        <Box width={detailWidth} height={height} position="relative">
          <DaemonDetailPanel
            service={selectedService}
            actions={daemonActions}
            width={detailWidth}
            height={height}
            onDaemonAction={onDaemonAction}
            suspended={daemonOperation === "restart"}
            logInputActive={logFocused}
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
      {selectedService && selectedService.id !== "daemon" && detailWidth > 0 && !daemonOperation && (
        <ServiceDetailPanel
          service={selectedService}
          width={detailWidth}
          height={height}
          focused={logFocused}
        />
      )}
    </Box>
  );
}
