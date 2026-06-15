import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "@deno-ink/core";
import { ALL_TARGET, type DeveloperState } from "@turbopanel/use-developer-state";
import { FleetSection } from "@turbopanel/sections/fleet-section";
import { LogsSection } from "@turbopanel/sections/logs-section";
import { ServiceStatusSection } from "@turbopanel/sections/service-status-section";
import { NetworkSection } from "@turbopanel/sections/network-section";
import { ShellSection } from "@turbopanel/sections/shell-section";
import { ConnectivitySection } from "@turbopanel/sections/connectivity-section";
import { DatabaseSection } from "@turbopanel/sections/database-section";
import { ServersSection } from "@turbopanel/sections/servers-section";

const SECTIONS = [
  { id: "logs", label: "Logs" },
  { id: "fleet", label: "Fleet" },
  { id: "services", label: "Services" },
  { id: "connectivity", label: "Connectivity" },
  { id: "database", label: "Database" },
  { id: "shell", label: "Shell" },
  { id: "network", label: "Network" },
  { id: "servers", label: "Servers" },
] as const;

export function DeveloperPanels({
  state,
  onEditingChange,
  onPanelFocusChange,
}: {
  state: DeveloperState;
  onEditingChange?: (editing: boolean) => void;
  onPanelFocusChange?: (focused: boolean) => void;
}) {
  const { healthOk, fleet, target, setTarget, targetLabel, error, recovery } =
    state;
  const [sectionIndex, setSectionIndex] = useState(0);
  const [panelFocused, setPanelFocused] = useState(false);
  const [editingActive, setEditingActive] = useState(false);
  const activeId = SECTIONS[sectionIndex].id;
  const interactiveSection = activeId === "fleet" ||
    activeId === "shell" ||
    activeId === "connectivity" ||
    activeId === "database" ||
    activeId === "servers" ||
    activeId === "network";

  const setEditing = (editing: boolean) => {
    setEditingActive(editing);
    onEditingChange?.(editing);
  };

  const setPanelFocus = (focused: boolean) => {
    setPanelFocused(focused);
    onPanelFocusChange?.(focused);
  };

  useEffect(() => {
    return () => onPanelFocusChange?.(false);
  }, [onPanelFocusChange]);

  const cycleTarget = () => {
    if (fleet.length === 0) {
      setTarget(ALL_TARGET);
      return;
    }
    if (target === ALL_TARGET) {
      setTarget(fleet[0].id);
      return;
    }
    const index = fleet.findIndex((entry) => entry.id === target);
    if (index === -1 || index >= fleet.length - 1) {
      setTarget(ALL_TARGET);
    } else {
      setTarget(fleet[index + 1].id);
    }
  };

  useInput((input, key) => {
    if (editingActive) return;

    if (key.escape && panelFocused) {
      setPanelFocus(false);
      return;
    }

    if (panelFocused) return;

    if (input === "t") {
      cycleTarget();
      return;
    }
    if (key.upArrow) {
      setSectionIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSectionIndex((i) => Math.min(SECTIONS.length - 1, i + 1));
      return;
    }
    if (key.return && interactiveSection) {
      setPanelFocus(true);
    }
  });

  const renderSection = () => {
    switch (activeId) {
      case "logs":
        return <LogsSection />;
      case "fleet":
        return (
          <FleetSection
            state={state}
            interactable={panelFocused}
            onEditingChange={setEditing}
          />
        );
      case "services":
        return <ServiceStatusSection />;
      case "network":
        return (
          <NetworkSection state={state} interactable={panelFocused} />
        );
      case "shell":
        return (
          <ShellSection
            state={state}
            interactable={panelFocused}
            onEditingChange={setEditing}
          />
        );
      case "connectivity":
        return (
          <ConnectivitySection state={state} interactable={panelFocused} />
        );
      case "database":
        return (
          <DatabaseSection
            state={state}
            interactable={panelFocused}
          />
        );
      case "servers":
        return (
          <ServersSection
            interactable={panelFocused}
            onEditingChange={setEditing}
          />
        );
    }
  };

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={recovery?.active
          ? "yellow"
          : healthOk
          ? "green"
          : healthOk === null
          ? "yellow"
          : "red"}>
          ●{" "}
        </Text>
        <Text>
          {fleet.length} server{fleet.length === 1 ? "" : "s"} · target:{" "}
          {targetLabel}
        </Text>
        <Text dimColor>
          {panelFocused
            ? " · Esc back"
            : " · ↑↓ section · Enter focus · t target"}
        </Text>
      </Box>
      {recovery?.active ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">⟳ {recovery.message}</Text>
          <Text dimColor>
            instance: {recovery.instanceDetail} · socket:{" "}
            {recovery.socketReady ? "ready" : "waiting"} · API:{" "}
            {recovery.apiHealthy ? "healthy" : "waiting"}
          </Text>
        </Box>
      ) : error ? (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      ) : null}

      <Box marginTop={1} flexDirection="row">
        <Box flexDirection="column" width={16}>
          {SECTIONS.map((section, index) => {
            const active = index === sectionIndex;
            return (
              <Text
                key={section.id}
                color={active ? "cyan" : undefined}
                bold={active}
                dimColor={!active}
              >
                {active ? `› ${section.label}` : `  ${section.label}`}
              </Text>
            );
          })}
        </Box>

        <Box
          flexDirection="column"
          flexGrow={1}
          marginLeft={1}
          paddingLeft={1}
          borderStyle="single"
          borderLeft
          borderTop={false}
          borderRight={false}
          borderBottom={false}
          borderDimColor
        >
          {renderSection()}
        </Box>
      </Box>
    </Box>
  );
}
