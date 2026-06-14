import React, { useState } from "react";
import { Box, Text, useInput } from "@deno-ink/core";
import { ALL_TARGET, useDeveloperState } from "@turbopanel/use-developer-state";
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

type SectionId = typeof SECTIONS[number]["id"];

export function DeveloperConsole({ onExit }: { onExit: () => void }) {
  const state = useDeveloperState();
  const { healthOk, fleet, target, setTarget, targetLabel, error } = state;
  const [sectionIndex, setSectionIndex] = useState(0);
  const [editingActive, setEditingActive] = useState(false);
  const activeId = SECTIONS[sectionIndex].id;

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
    if (!editingActive) {
      if (input === "q" || key.escape) {
        onExit();
        return;
      }
      if (input === "t") {
        cycleTarget();
        return;
      }
      if (input === "[") {
        setSectionIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (input === "]") {
        setSectionIndex((i) => Math.min(SECTIONS.length - 1, i + 1));
        return;
      }
    }
    const sidebarSections: SectionId[] = ["services", "network", "connectivity"];
    if (sidebarSections.includes(activeId)) {
      if (key.upArrow) {
        setSectionIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setSectionIndex((i) => Math.min(SECTIONS.length - 1, i + 1));
      }
    }
  });

  const renderSection = () => {
    switch (activeId) {
      case "fleet":
        return (
          <FleetSection state={state} onEditingChange={setEditingActive} />
        );
      case "services":
        return <ServiceStatusSection />;
      case "network":
        return <NetworkSection state={state} />;
      case "shell":
        return (
          <ShellSection state={state} onEditingChange={setEditingActive} />
        );
      case "connectivity":
        return <ConnectivitySection state={state} />;
      case "database":
        return <DatabaseSection state={state} />;
      case "servers":
        return <ServersSection onEditingChange={setEditingActive} />;
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">Developer Console</Text>
      <Box marginTop={1}>
        <Text color={healthOk ? "green" : healthOk === null ? "yellow" : "red"}>
          ●{" "}
        </Text>
        <Text>
          {fleet.length} server{fleet.length === 1 ? "" : "s"} · target:{" "}
          {targetLabel}
        </Text>
        <Text dimColor> · t cycle target · q exit</Text>
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Box width={22} flexDirection="column">
          <Text bold dimColor>Sections [ ]</Text>
          {SECTIONS.map((section, index) => (
            <Text
              key={section.id}
              color={index === sectionIndex ? "cyan" : undefined}
              bold={index === sectionIndex}
            >
              {index === sectionIndex ? "› " : "  "}{section.label}
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
