import React from "react";
import { Box, Text } from "ink";
import { DeveloperScreen } from "@turbopanel/screens/developer-screen.tsx";
import { InstanceScreen } from "@turbopanel/screens/instance-screen.tsx";
import { StatusScreen } from "@turbopanel/screens/status-screen.tsx";
import type { RepoStatus } from "@turbopanel/lib/paths.ts";
import type { StackUnitStatus } from "@turbopanel/lib/stack-status.ts";
import type { DeveloperState } from "@turbopanel/hooks/use-developer-state.ts";

export type MainScreenArea = "status" | "instance" | "developer";

export function MainScreen({
  area,
  mainHeight,
  runtimeReady,
  daemonStatus,
  daemonPresent,
  platformDirectAccess,
  stackUnits,
  developerUnlocked,
  stackHealthy,
  developerState,
  onInstanceSwitch,
  onDeveloperEditingChange,
  onDeveloperPanelFocusChange,
}: {
  area: MainScreenArea;
  mainHeight: number;
  runtimeReady: boolean;
  daemonStatus: RepoStatus;
  daemonPresent: boolean;
  platformDirectAccess: boolean;
  stackUnits: StackUnitStatus[];
  developerUnlocked: boolean;
  stackHealthy: boolean;
  developerState: DeveloperState;
  onInstanceSwitch: (target: "deno" | "workers") => void;
  onDeveloperEditingChange: (editing: boolean) => void;
  onDeveloperPanelFocusChange: (focused: boolean) => void;
}) {
  let content: React.ReactNode;

  if (!daemonPresent) {
    content = (
      <Text dimColor>
        Daemon not installed — press m for menu, then Install/update daemon
      </Text>
    );
  } else if (area === "status") {
    content = (
      <StatusScreen
        runtimeReady={runtimeReady}
        daemonStatus={daemonStatus}
        daemonPresent={daemonPresent}
        platformDirectAccess={platformDirectAccess}
        stackUnits={stackUnits}
        developerUnlocked={developerUnlocked}
        stackHealthy={stackHealthy}
      />
    );
  } else if (area === "instance") {
    content = <InstanceScreen onSwitch={onInstanceSwitch} />;
  } else if (!developerUnlocked) {
    content = (
      <Text dimColor>
        Waiting for instance — check Status area or m menu to start dev stack
      </Text>
    );
  } else if (developerState.healthOk === null && !developerState.error) {
    content = <Text dimColor>Connecting to instance API…</Text>;
  } else {
    content = (
      <DeveloperScreen
        mainHeight={mainHeight}
        state={developerState}
        onEditingChange={onDeveloperEditingChange}
        onPanelFocusChange={onDeveloperPanelFocusChange}
      />
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} width="100%">
      {content}
    </Box>
  );
}
