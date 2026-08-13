import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { ScrollList } from "ink-scroll-list";
import type { DevService } from "../dev-services.ts";
import {
  daemonMenuActions,
  type DaemonActionId,
} from "../lib/daemon-actions.ts";
import { readInstanceRuntime } from "../lib/daemon-env.ts";
import type { PendingRestart, PendingOptionalServices, ServiceOperation } from "../hooks/use-console-app.ts";
import type {
  ConvergeServicePhase,
  DevEnvConvergeState,
} from "../hooks/use-dev-env-converge.ts";
import { useSpinnerFrame } from "../hooks/use-spinner-frame.ts";
import {
  canRunServiceAction,
  serviceActionForKey,
  type ServiceActionId,
} from "../lib/service-actions.ts";
import type { ConsoleLogLine } from "../lib/service-restart.ts";
import type { DaemonLogByteFloor } from "../lib/daemon-log.ts";
import type { ServiceLogByteFloor } from "../lib/service-log.ts";
import { openServiceLogPager } from "../lib/service-log-pager.ts";
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
import { prewarmTitleArt } from "./service-title.tsx";

/**
 * Wait for the list cursor to settle before swapping the detail pane.
 * While moving, keep the previous detail mounted (frozen) so Ink does not
 * tear down hundreds of log Text nodes on every arrow key.
 */
const PARENT_IDLE_MS = 500;

const EMPTY_OVERLAY: ConsoleLogLine[] = [];

const ARROW_WIDTH = 1;
const LIST_PADDING_RIGHT = 1;
/** Right border only (`borderRight` on the list Box). */
const SERVICE_LIST_BORDER_COLUMNS = 1;
const MIN_DETAIL_WIDTH = 28;
const CONVERGE_PANEL_MIN_HEIGHT = 8;

export function serviceListWidth(services: DevService[]): number {
  const longestLabel = services.reduce(
    (max, service) => Math.max(max, service.label.length),
    0,
  );

  return (
    ARROW_WIDTH + longestLabel + LIST_PADDING_RIGHT + SERVICE_LIST_BORDER_COLUMNS
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
  spinnerFrame,
}: {
  label: string;
  phase: ConvergeServicePhase;
  dimColor: boolean;
  spinnerFrame: number;
}) {
  const { primary, secondary } = phaseColors(phase);
  const chars = [...label];
  const frame = spinnerFrame % Math.max(chars.length, 1);

  return (
    <Text dimColor={dimColor} wrap="truncate">
      {chars.map((char, index) => (
        <Text
          key={`${index}-${char}`}
          color={frame === index ? primary : secondary}
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

function handleServicesListInput(options: {
  input: string;
  key: { upArrow?: boolean; downArrow?: boolean };
  listIndex: number;
  visibleFullIndices: number[];
  settledService: DevService | null;
  onServiceAction?: (serviceId: string, action: ServiceActionId) => void | Promise<void>;
  setListIndex: (index: number) => void;
}): void {
  const {
    input,
    key,
    listIndex,
    visibleFullIndices,
    settledService,
    onServiceAction,
    setListIndex,
  } = options;

  const currentVisiblePos = visibleFullIndices.indexOf(listIndex);
  if (key.upArrow && visibleFullIndices.length > 0) {
    const nextPos = Math.max(0, currentVisiblePos - 1);
    setListIndex(visibleFullIndices[nextPos]!);
    return;
  }
  if (key.downArrow && visibleFullIndices.length > 0) {
    const nextPos = Math.min(visibleFullIndices.length - 1, currentVisiblePos + 1);
    setListIndex(visibleFullIndices[nextPos]!);
    return;
  }

  if (!settledService || !onServiceAction) {
    return;
  }
  const runtime = readInstanceRuntime();
  const action = serviceActionForKey(settledService.id, input, runtime);
  if (
    action &&
    canRunServiceAction(settledService.id, action, settledService.status, runtime)
  ) {
    void Promise.resolve(onServiceAction(settledService.id, action));
  }
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
  daemonLogByteFloor,
  instanceLogByteFloor,
  onConfirmRestart,
  onCancelRestart,
  pendingOptionalServices,
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
  daemonLogByteFloor?: DaemonLogByteFloor | null;
  instanceLogByteFloor?: ServiceLogByteFloor | null;
  onConfirmRestart?: () => void;
  onCancelRestart?: () => void;
  pendingOptionalServices?: PendingOptionalServices | null;
  devEnvConverge?: DevEnvConvergeState | null;
  onDismissDevEnvConvergeError?: () => void;
}) {
  const { suspendTerminal } = useApp();
  const { leftWidth, detailWidth } = resolvePaneWidths(width, services);
  const servicePhases = devEnvConverge?.servicePhases ?? {};
  const convergeSummaryVisible = Boolean(
    devEnvConverge &&
      (daemonOperation === "dev-env" || devEnvConverge.active || devEnvConverge.error),
  );
  const convergePanelHeight = convergeSummaryVisible
    ? Math.min(Math.floor(height * 0.4), Math.max(CONVERGE_PANEL_MIN_HEIGHT, height - 6))
    : 0;
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
  // Banner when only the daemon is up and converge is not already showing.
  const needsConvergeHint = Boolean(
    !convergeSummaryVisible &&
      displayServices.length === 1 &&
      displayServices[0]?.id === "daemon",
  );
  const serviceDetailHeight = Math.max(
    1,
    height - convergePanelHeight - (needsConvergeHint ? 2 : 0),
  );

  // Local list cursor — updating this must NOT call into useConsoleApp or the
  // whole Ink tree (menu/status/detail) re-renders (~250ms per keypress).
  const parentIndex = useMemo(
    () => nearestVisibleFullIndex(selectedIndex, visibleFullIndices),
    [selectedIndex, visibleFullIndices],
  );
  const [listIndex, setListIndex] = useState(parentIndex);
  const committedIndexRef = useRef(parentIndex);

  // Adopt external parent selection (e.g. converge pin). Ignore echoes of our
  // own idle commits so a late parent update cannot yank the cursor back.
  useEffect(() => {
    if (parentIndex === listIndex) {
      return;
    }
    if (parentIndex === committedIndexRef.current) {
      return;
    }
    committedIndexRef.current = parentIndex;
    setListIndex(parentIndex);
  }, [parentIndex, listIndex, services]);

  // Detail tracks the cursor directly — the mount is ~10ms once the parent
  // reconcile is off the hot path (Hypothesis K, confirmed), so no debounce.
  const settledService = services[listIndex] ?? null;
  const displaySelectedIndex = useMemo(() => {
    const index = visibleFullIndices.indexOf(listIndex);
    return index >= 0 ? index : 0;
  }, [listIndex, visibleFullIndices]);

  // Push the selection to the parent (status-bar hints only) on a longer idle
  // so the full-app reconcile never runs mid-scroll.
  useEffect(() => {
    if (!onSelectedIndexChange) {
      return;
    }
    const id = setTimeout(() => {
      committedIndexRef.current = listIndex;
      onSelectedIndexChange(listIndex);
    }, PARENT_IDLE_MS);
    return () => clearTimeout(id);
  }, [listIndex, services, onSelectedIndexChange]);

  // Warm figlet once per service-list change (not per keystroke — the list ref
  // is stable during navigation, so this stays off the hot path).
  useEffect(() => {
    if (detailWidth <= 0) {
      return;
    }
    const labels = displayServices.map((service) => service.label);
    return prewarmTitleArt(labels, Math.max(1, detailWidth - 2));
  }, [displayServices, detailWidth]);

  const needsConvergeAnimation = useMemo(
    () =>
      displayServices.some((service) =>
        shouldAnimateConvergeLabel(service, servicePhases[service.id]),
      ) ||
      Boolean(
        devEnvConverge &&
          (devEnvConverge.active ||
            devEnvConverge.tasks.some((task) => task.status === "running")),
      ),
    [displayServices, devEnvConverge, servicePhases],
  );
  const convergeSpinnerFrame = useSpinnerFrame(needsConvergeAnimation ? 120 : 0);
  const [logFocused, setLogFocused] = useState(false);
  const daemonActions = useMemo(
    () => (settledService?.id === "daemon" ? daemonMenuActions(settledService.status) : []),
    [settledService],
  );

  const overlayForService = (serviceId: string): ConsoleLogLine[] =>
    restartOverlayServiceId === serviceId ? (restartLogOverlay ?? EMPTY_OVERLAY) : EMPTY_OVERLAY;

  useEffect(() => {
    setLogFocused(false);
  }, [listIndex]);

  useEffect(() => {
    if (restartInProgress) {
      onRefreshServices?.();
    }
  }, [restartInProgress, onRefreshServices]);

  useInput((_input, key) => {
    if (pendingRestart || restartInProgress || serviceOperation || pendingOptionalServices) {
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

    // Break out of the Ink alternate screen into `less` / docker / journalctl.
    // Works whether or not the in-TUI log pane is focused.
    if (settledService && _input.toLowerCase() === "t") {
      void suspendTerminal(() => {
        openServiceLogPager(settledService.id);
      });
      return;
    }

    if (logFocused) {
      return;
    }

    handleServicesListInput({
      input: _input,
      key,
      listIndex,
      visibleFullIndices,
      settledService,
      onServiceAction,
      setListIndex,
    });
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
                width={Math.max(1, leftWidth - SERVICE_LIST_BORDER_COLUMNS)}
                flexDirection="row"
                paddingRight={LIST_PADDING_RIGHT}
              >
                <Text dimColor={!focused}>{focused ? "›" : " "}</Text>
                {animatePhase ? (
                  <ConvergeServiceLabel
                    label={service.label}
                    phase={phase}
                    dimColor={!focused}
                    spinnerFrame={convergeSpinnerFrame}
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
                spinnerFrame={convergeSpinnerFrame}
              />
            </Box>
          )}
          {needsConvergeHint && (
            <Box width={detailWidth} height={2} paddingX={1} flexShrink={0}>
              <Text color={MENU_BLUE}>
                Development stack not installed yet — open Developer → Converge /
                re-converge development environment, then press Enter.
              </Text>
            </Box>
          )}
          {/*
            Keep the last settled detail mounted while the list cursor moves.
            Swapping to a skeleton/unmounting logs was ~300ms per keypress.
          */}
          {settledService?.id === "daemon" && (
            <Box
              width={detailWidth}
              height={serviceDetailHeight}
              flexGrow={convergeSummaryVisible ? 1 : 0}
              position="relative"
            >
              <DaemonDetailPanel
                service={settledService}
                actions={daemonActions}
                width={detailWidth}
                height={serviceDetailHeight}
                onDaemonAction={onDaemonAction}
                logInputActive={logFocused && !pendingRestart && !restartInProgress}
                logOverlayLines={overlayForService("daemon")}
                logFollowResetKey={logFollowResetKey}
                daemonLogByteFloor={daemonLogByteFloor}
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
          {settledService &&
            settledService.id !== "daemon" &&
            (!daemonOperation || daemonOperation === "dev-env") && (
            <Box
              width={detailWidth}
              height={serviceDetailHeight}
              flexGrow={convergeSummaryVisible ? 1 : 0}
              position="relative"
            >
              <ServiceDetailPanel
                service={settledService}
                width={detailWidth}
                height={serviceDetailHeight}
                focused={logFocused && !pendingRestart && !restartInProgress}
                logOverlayLines={overlayForService(settledService.id)}
                logFollowResetKey={logFollowResetKey}
                logByteFloor={
                  settledService.id === "instance" ? instanceLogByteFloor : null
                }
              />
              {pendingRestart?.serviceId === settledService.id &&
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
