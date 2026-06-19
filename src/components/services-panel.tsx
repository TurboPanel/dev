import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { ScrollList } from "ink-scroll-list";
import type { DevService } from "../dev-services.ts";
import {
  daemonMenuActions,
  type DaemonActionId,
} from "../lib/daemon-actions.ts";
import type { DaemonOperation } from "../lib/spinners.ts";
import { BORDER_COLOR, DARK_GREY, LIST_FOCUS_BG, LIST_FOCUS_FG, LIST_OPEN_BG, LIST_OPEN_FG } from "../theme.ts";
import { PurgeDaemonPanel } from "./purge-daemon-panel.tsx";
import { RestartDaemonPanel } from "./restart-daemon-panel.tsx";
import { ServiceDetailPanel } from "./service-detail-panel.tsx";
import { ServiceStatusIndicator } from "./service-status.tsx";

const LIST_PADDING_RIGHT = 1;
const LIST_GAP = 1;
const STATUS_WIDTH = 1;
const LIST_LEADING_WIDTH = STATUS_WIDTH + LIST_GAP;
const LIST_TRAILING_WIDTH = LIST_PADDING_RIGHT;
const SERVICE_LIST_BORDER_COLUMNS = 2;

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

export function ServicesPanel({
  width,
  height,
  services,
  selectedIndex,
  openServiceId,
  onOpenService,
  onCloseService,
  onDaemonAction,
  onSelectedIndexChange,
  onRestartDone,
  onPurgeDone,
  onInstallFinished,
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
  onSelectedIndexChange?: (index: number) => void;
  onRestartDone?: () => void;
  onPurgeDone?: () => void;
  onInstallFinished?: (success: boolean) => void;
}) {
  const leftWidth = serviceListWidth(services);
  const openService = openServiceId
    ? services.find((service) => service.id === openServiceId) ?? null
    : null;
  const detailWidth = Math.max(0, width - leftWidth);
  const inDetail = openServiceId !== null;
  const openServiceIndex = openServiceId
    ? services.findIndex((service) => service.id === openServiceId)
    : -1;
  const listScrollIndex = inDetail && openServiceIndex >= 0
    ? openServiceIndex
    : selectedIndex;
  const actions = useMemo(
    () => (openService?.id === "daemon" ? daemonMenuActions(openService.status) : []),
    [openService],
  );
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    setSelectedActionIndex(0);
    setActionMessage(null);
  }, [openServiceId]);

  useEffect(() => {
    if (selectedActionIndex >= actions.length) {
      setSelectedActionIndex(Math.max(0, actions.length - 1));
    }
  }, [actions.length, selectedActionIndex]);

  useInput((_input, key) => {
    if (daemonOperation) {
      return;
    }

    if (inDetail) {
      if (key.escape && onCloseService) {
        onCloseService();
        return;
      }

      const lastAction = actions.length - 1;
      if (key.upArrow) {
        setSelectedActionIndex((index) => Math.max(0, index - 1));
        setActionMessage(null);
      }
      if (key.downArrow) {
        setSelectedActionIndex((index) => Math.min(lastAction, index + 1));
        setActionMessage(null);
      }
      if (key.return && actions.length > 0 && onDaemonAction) {
        const action = actions[selectedActionIndex];
        if (action) {
          void Promise.resolve(onDaemonAction(action)).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            setActionMessage(message);
          });
        }
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
        backgroundColor={DARK_GREY}
        borderStyle="single"
        borderColor={BORDER_COLOR}
        borderBackgroundColor={DARK_GREY}
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
              service.id === "daemon" && daemonOperation ? daemonOperation : null;
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
                  dimmed={dimmed}
                  highlighted={opened}
                  operation={daemonOp}
                />
                <Text
                  color={rowForeground}
                  bold={focused || opened}
                  dimColor={dimmed}
                >
                  {service.label}
                </Text>
              </Box>
            );
          })}
        </ScrollList>
      </Box>
      {daemonOperation === "restart" && detailWidth > 0 && onRestartDone && (
        <RestartDaemonPanel
          width={detailWidth}
          height={height}
          onDone={onRestartDone}
          onInstallFinished={onInstallFinished}
        />
      )}
      {daemonOperation === "purge" && detailWidth > 0 && onPurgeDone && (
        <PurgeDaemonPanel
          width={detailWidth}
          height={height}
          onDone={onPurgeDone}
        />
      )}
      {openService && detailWidth > 0 && !daemonOperation && (
        <ServiceDetailPanel
          service={openService}
          actions={actions}
          selectedActionIndex={selectedActionIndex}
          width={detailWidth}
          height={height}
          message={actionMessage}
        />
      )}
    </Box>
  );
}
