import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "@deno-ink/core";
import { ALL_TARGET, type DeveloperState } from "@turbopanel/use-developer-state";
import { FleetSection } from "@turbopanel/sections/fleet-section";
import { LogsSection } from "@turbopanel/sections/logs-section";
import { NetworkSection } from "@turbopanel/sections/network-section";
import { ShellSection } from "@turbopanel/sections/shell-section";
import { ConnectivitySection } from "@turbopanel/sections/connectivity-section";
import { DatabaseSection } from "@turbopanel/sections/database-section";
import { ServersSection } from "@turbopanel/sections/servers-section";

const SECTIONS = [
  { id: "logs", label: "Logs" },
  { id: "fleet", label: "Fleet" },
  { id: "database", label: "Database" },
  { id: "connectivity", label: "Events" },
  { id: "shell", label: "Shell" },
  { id: "network", label: "Network" },
  { id: "servers", label: "Servers" },
] as const;

export function DeveloperPanels({
  contentHeight,
  state,
  onEditingChange,
  onPanelFocusChange,
}: {
  contentHeight: number;
  state: DeveloperState;
  onEditingChange?: (editing: boolean) => void;
  onPanelFocusChange?: (focused: boolean) => void;
}) {
  const { target, setTarget, fleet } = state;
  const [sectionIndex, setSectionIndex] = useState(0);
  const [panelFocused, setPanelFocused] = useState(false);
  const [editingActive, setEditingActive] = useState(false);
  const activeId = SECTIONS[sectionIndex].id;
  const panelLines = Math.max(3, contentHeight);
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
        return <LogsSection maxLines={panelLines - 1} />;
      case "fleet":
        return (
          <FleetSection
            state={state}
            interactable={panelFocused}
            onEditingChange={setEditing}
          />
        );
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
            maxLines={panelLines - 3}
          />
        );
      case "connectivity":
        return (
          <ConnectivitySection
            state={state}
            interactable={panelFocused}
            maxLines={panelLines - 2}
          />
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
    <Box flexDirection="row" height={contentHeight} width="100%">
      <Box flexDirection="column" width={12} height={contentHeight}>
        {SECTIONS.map((section, index) => {
          const active = index === sectionIndex;
          return (
            <Text
              key={section.id}
              color={active ? "cyan" : undefined}
              bold={active}
              dimColor={!active}
            >
              {active ? `›${section.label}` : ` ${section.label}`}
            </Text>
          );
        })}
      </Box>

      <Box
        flexDirection="column"
        flexGrow={1}
        height={contentHeight}
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
  );
}
