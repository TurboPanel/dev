import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "@deno-ink/core";
import { ALL_TARGET, type DeveloperState } from "@turbopanel/use-developer-state";
import { FleetSection } from "@turbopanel/sections/fleet-section";
import { ServiceStatusSection } from "@turbopanel/sections/service-status-section";
import { NetworkSection } from "@turbopanel/sections/network-section";
import { ShellSection } from "@turbopanel/sections/shell-section";
import { ConnectivitySection } from "@turbopanel/sections/connectivity-section";
import { DatabaseSection } from "@turbopanel/sections/database-section";
import { ServersSection } from "@turbopanel/sections/servers-section";

const SECTIONS = [
  { id: "fleet", label: "Fleet" },
  { id: "services", label: "Services" },
  { id: "network", label: "Network" },
  { id: "shell", label: "Shell" },
  { id: "connectivity", label: "Connectivity" },
  { id: "database", label: "Database" },
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
  const { healthOk, fleet, target, setTarget, targetLabel, error } = state;
  const [sectionIndex, setSectionIndex] = useState(0);
  const [panelFocused, setPanelFocused] = useState(false);
  const [editingActive, setEditingActive] = useState(false);
  const activeId = SECTIONS[sectionIndex].id;

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
    if (key.return) {
      setPanelFocus(true);
    }
  });

  const renderSection = () => {
    switch (activeId) {
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
        <Text color={healthOk ? "green" : healthOk === null ? "yellow" : "red"}>
          ●{" "}
        </Text>
        <Text>
          {fleet.length} server{fleet.length === 1 ? "" : "s"} · target:{" "}
          {targetLabel}
        </Text>
        <Text dimColor>
          {panelFocused ? " · Esc back" : " · t cycle target · Enter open"}
        </Text>
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Box width={22} flexDirection="column">
          <Text bold dimColor>
            {panelFocused ? "Sections" : "Sections ↑↓"}
          </Text>
          {SECTIONS.map((section, index) => (
            <Text
              key={section.id}
              color={!panelFocused && index === sectionIndex ? "cyan" : undefined}
              bold={!panelFocused && index === sectionIndex}
              dimColor={panelFocused || index !== sectionIndex}
            >
              {!panelFocused && index === sectionIndex ? "› " : "  "}
              {section.label}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" marginLeft={2} flexGrow={1}>
          {renderSection()}
        </Box>
      </Box>
    </Box>
  );
}
