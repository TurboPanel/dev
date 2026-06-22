import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { ScrollList } from "ink-scroll-list";
import type { DevService } from "../dev-services.ts";
import {
  daemonMenuActions,
  type DaemonActionId,
} from "../lib/daemon-actions.ts";
import { readInstanceRuntime } from "../lib/daemon-env.ts";
import type { PendingRestart, ServiceOperation } from "../hooks/use-console-app.ts";
import type {
  ConvergeServicePhase,
  DevEnvConvergeState,
} from "../hooks/use-dev-env-converge.ts";
import {
  canRunServiceAction,
  serviceActionForKey,
  type ServiceActionId,
} from "../lib/service-actions.ts";
import type { ConsoleLogLine } from "../lib/service-restart.ts";
import type { DaemonOperation } from "../lib/spinners.ts";
import {
  BORDER_COLOR,
  MENU_BLUE,
  STATUS_COMPILING,
  STATUS_INSTALLING,
  STATUS_PENDING,
} from "../theme.ts";
import { DevEnvConvergePanel } from "./dev-env-converge-panel.tsx";
import { DaemonDetailPanel } from "./daemon-detail-panel.tsx";
import { RestartServiceModal } from "./restart-service-modal.tsx";
import { ServiceDetailPanel } from "./service-detail-panel.tsx";
import { serviceStatusColor } from "./service-status.tsx";

const ARROW_WIDTH = 1;
const LIST_PADDING_RIGHT = 1;
const LIST_LEADING_WIDTH = ARROW_WIDTH;
const LIST_TRAILING_WIDTH = LIST_PADDING_RIGHT;
const SERVICE_LIST_BORDER_COLUMNS = 2;
const MIN_DETAIL_WIDTH = 28;
const CONVERGE_PANEL_MIN_HEIGHT = 8;

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

function nearestVisibleFullIndex(
  selectedIndex: number,
  visibleFullIndices: number[],
): number {
  if (visibleFullIndices.length === 0) {
    return selectedIndex;
  }
  if (visibleFullIndices.includes(selectedIndex)) {
    return selectedIndex;
  }
  let nearest = visibleFullIndices[0];
  let minDistance = Math.abs(selectedIndex - nearest);
  for (const index of visibleFullIndices) {
    const distance = Math.abs(selectedIndex - index);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = index;
    }
  }
  return nearest;
}

function phaseColors(phase: ConvergeServicePhase): {
  primary: string;
  secondary: string;
} {
  if (phase === "compiling") {
    return { primary: STATUS_COMPILING, secondary: MENU_BLUE };
  }
  return { primary: STATUS_INSTALLING, secondary: MENU_BLUE };
}

function shouldAnimateConvergeLabel(
  service: DevService,
  phase: ConvergeServicePhase | undefined,
): phase is ConvergeServicePhase {
  if (service.status === "running" || !phase) {
    return false;
  }
  return phase === "installing" || phase === "compiling";
}

function ConvergeServiceLabel({
  label,
  phase,
  dimColor,
}: {
  label: string;
  phase: ConvergeServicePhase;
  dimColor: boolean;
}) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((current) => current + 1), 120);
    return () => clearInterval(id);
  }, []);

  const { primary, secondary } = phaseColors(phase);
  const chars = [...label];

  return (
    <Text dimColor={dimColor} wrap="truncate">
      {chars.map((char, index) => (
        <Text
          key={`${index}-${char}`}
          color={(frame % chars.length) === index ? primary : secondary}
        >
          {char}
        </Text>
      ))}
    </Text>
  );
}

function serviceInConverge(
  serviceId: string,
  servicePhases: Record<string, ConvergeServicePhase>,
): boolean {
  const phase = servicePhases[serviceId];
  return phase === "installing" || phase === "compiling" || phase === "ready";
}

export function ServicesPanel({
  width,
  height,
  services,
  selectedIndex,
  onDaemonAction,
  onSelectedIndexChange,
  onRefreshServices,
  daemonOperation,
  serviceOperation,
  onServiceAction,
  pendingRestart,
  restartInProgress,
  restartOverlayServiceId,
  restartLogOverlay,
  logFollowResetKey,
  onConfirmRestart,
  onCancelRestart,
  devEnvConverge,
  onDismissDevEnvConvergeError,
}: {
  width: number;
  height: number;
  services: DevService[];
  selectedIndex: number;
  daemonOperation?: DaemonOperation | null;
  serviceOperation?: ServiceOperation | null;
  onServiceAction?: (serviceId: string, action: ServiceActionId) => void | Promise<void>;
  onDaemonAction?: (action: DaemonActionId) => void | Promise<void>;
  onSelectedIndexChange?: (index: number) => void;
  onRefreshServices?: () => void;
  pendingRestart?: PendingRestart | null;
  restartInProgress?: string | null;
  restartOverlayServiceId?: string | null;
  restartLogOverlay?: ConsoleLogLine[];
  logFollowResetKey?: number;
  onConfirmRestart?: () => void;
  onCancelRestart?: () => void;
  devEnvConverge?: DevEnvConvergeState | null;
  onDismissDevEnvConvergeError?: () => void;
}) {
  const { leftWidth, detailWidth } = resolvePaneWidths(width, services);
  const servicePhases = devEnvConverge?.servicePhases ?? {};
  const convergeSummaryVisible = Boolean(
    devEnvConverge &&
      (daemonOperation === "dev-env" || devEnvConverge.active || devEnvConverge.error),
  );
  const convergePanelHeight = convergeSummaryVisible
    ? Math.min(Math.floor(height * 0.4), Math.max(CONVERGE_PANEL_MIN_HEIGHT, height - 6))
    : 0;
  const serviceDetailHeight = Math.max(1, height - convergePanelHeight);
  const { displayServices, visibleFullIndices } = useMemo(() => {
    const visible: DevService[] = [];
    const fullIndices: number[] = [];
    services.forEach((service, index) => {
      if (
        service.status === "running" ||
        service.status === "starting" ||
        service.status === "failed" ||
        service.status === "stopped" ||
        serviceInConverge(service.id, servicePhases)
      ) {
        visible.push(service);
        fullIndices.push(index);
      }
    });
    return { displayServices: visible, visibleFullIndices: fullIndices };
  }, [services, servicePhases]);
  const effectiveSelectedIndex = useMemo(
    () => nearestVisibleFullIndex(selectedIndex, visibleFullIndices),
    [selectedIndex, visibleFullIndices],
  );
  const selectedService = services[effectiveSelectedIndex] ?? null;
  const displaySelectedIndex = useMemo(() => {
    const index = visibleFullIndices.indexOf(effectiveSelectedIndex);
    return index >= 0 ? index : 0;
  }, [effectiveSelectedIndex, visibleFullIndices]);
  const [logFocused, setLogFocused] = useState(false);
  const daemonActions = useMemo(
    () => (selectedService?.id === "daemon" ? daemonMenuActions(selectedService.status) : []),
    [selectedService],
  );

  const overlayForService = (serviceId: string): ConsoleLogLine[] =>
    restartOverlayServiceId === serviceId ? (restartLogOverlay ?? []) : [];

  useEffect(() => {
    setLogFocused(false);
  }, [effectiveSelectedIndex]);

  useEffect(() => {
    if (
      visibleFullIndices.length > 0 &&
      selectedIndex !== effectiveSelectedIndex &&
      onSelectedIndexChange
    ) {
      onSelectedIndexChange(effectiveSelectedIndex);
    }
  }, [selectedIndex, effectiveSelectedIndex, visibleFullIndices, onSelectedIndexChange]);

  useEffect(() => {
    if (restartInProgress) {
      onRefreshServices?.();
    }
  }, [restartInProgress, onRefreshServices]);

  useInput((_input, key) => {
    if (pendingRestart || restartInProgress || serviceOperation) {
      return;
    }

    if (devEnvConverge?.error && onDismissDevEnvConvergeError) {
      onDismissDevEnvConvergeError();
      return;
    }

    if (key.tab) {
      setLogFocused((focused) => !focused);
      return;
    }

    if (logFocused) {
      return;
    }

    const currentVisiblePos = visibleFullIndices.indexOf(effectiveSelectedIndex);
    if (key.upArrow && onSelectedIndexChange && visibleFullIndices.length > 0) {
      const nextPos = Math.max(0, currentVisiblePos - 1);
      onSelectedIndexChange(visibleFullIndices[nextPos]);
      return;
    }
    if (key.downArrow && onSelectedIndexChange && visibleFullIndices.length > 0) {
      const nextPos = Math.min(visibleFullIndices.length - 1, currentVisiblePos + 1);
      onSelectedIndexChange(visibleFullIndices[nextPos]);
      return;
    }

    if (selectedService && onServiceAction) {
      const runtime = readInstanceRuntime();
      const action = serviceActionForKey(selectedService.id, _input, runtime);
      if (
        action &&
        canRunServiceAction(selectedService.id, action, selectedService.status, runtime)
      ) {
        void Promise.resolve(onServiceAction(selectedService.id, action));
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
        <ScrollList height={height} selectedIndex={displaySelectedIndex}>
          {displayServices.map((service, index) => {
            const focused = index === displaySelectedIndex;
            const restarting = restartInProgress === service.id;
            const phase = servicePhases[service.id];
            const animatePhase = shouldAnimateConvergeLabel(service, phase);
            const labelColor = animatePhase
              ? undefined
              : phase === "ready" && service.status !== "running"
              ? STATUS_PENDING
              : serviceStatusColor(service.status, {
                  operation:
                    service.id === "daemon" && daemonOperation
                      ? daemonOperation
                      : restarting
                      ? "restart"
                      : null,
                  busy:
                    serviceOperation?.serviceId === service.id &&
                    serviceOperation.action !== "restart",
                });
            return (
              <Box
                key={service.id}
                width={Math.max(1, leftWidth - 1)}
                flexDirection="row"
                paddingRight={LIST_PADDING_RIGHT}
              >
                <Text dimColor={!focused}>{focused ? "›" : " "}</Text>
                {animatePhase ? (
                  <ConvergeServiceLabel
                    label={service.label}
                    phase={phase}
                    dimColor={!focused}
                  />
                ) : (
                  <Text color={labelColor} dimColor={!focused} wrap="truncate">
                    {service.label}
                  </Text>
                )}
              </Box>
            );
          })}
        </ScrollList>
      </Box>
      {detailWidth > 0 && (
        <Box flexDirection="column" width={detailWidth} height={height}>
          {convergeSummaryVisible && devEnvConverge && convergePanelHeight > 0 && (
            <Box height={convergePanelHeight} flexShrink={0}>
              <DevEnvConvergePanel
                width={detailWidth}
                height={convergePanelHeight}
                converge={devEnvConverge}
                onDismissError={onDismissDevEnvConvergeError}
              />
            </Box>
          )}
          {selectedService?.id === "daemon" && (
            <Box
              width={detailWidth}
              height={serviceDetailHeight}
              flexGrow={convergeSummaryVisible ? 1 : 0}
              position="relative"
            >
              <DaemonDetailPanel
                service={selectedService}
                actions={daemonActions}
                width={detailWidth}
                height={serviceDetailHeight}
                onDaemonAction={onDaemonAction}
                logInputActive={logFocused && !pendingRestart && !restartInProgress}
                logOverlayLines={overlayForService("daemon")}
                logFollowResetKey={logFollowResetKey}
              />
              {pendingRestart?.serviceId === "daemon" && onConfirmRestart && onCancelRestart && (
                <RestartServiceModal
                  width={detailWidth}
                  height={serviceDetailHeight}
                  serviceLabel={pendingRestart.label}
                  onConfirm={onConfirmRestart}
                  onCancel={onCancelRestart}
                />
              )}
            </Box>
          )}
          {selectedService &&
            selectedService.id !== "daemon" &&
            (!daemonOperation || daemonOperation === "dev-env") && (
            <Box
              width={detailWidth}
              height={serviceDetailHeight}
              flexGrow={convergeSummaryVisible ? 1 : 0}
              position="relative"
            >
              <ServiceDetailPanel
                key={selectedService.id}
                service={selectedService}
                width={detailWidth}
                height={serviceDetailHeight}
                focused={logFocused && !pendingRestart && !restartInProgress}
                logOverlayLines={overlayForService(selectedService.id)}
                logFollowResetKey={logFollowResetKey}
              />
              {pendingRestart?.serviceId === selectedService.id &&
                onConfirmRestart &&
                onCancelRestart && (
                <RestartServiceModal
                  width={detailWidth}
                  height={serviceDetailHeight}
                  serviceLabel={pendingRestart.label}
                  onConfirm={onConfirmRestart}
                  onCancel={onCancelRestart}
                />
              )}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
