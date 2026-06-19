import React from "react";
import { DeveloperPanels } from "@turbopanel/components/developer-panels.tsx";
import type { DeveloperState } from "@turbopanel/hooks/use-developer-state.ts";

export function DeveloperScreen({
  mainHeight,
  state,
  onEditingChange,
  onPanelFocusChange,
}: {
  mainHeight: number;
  state: DeveloperState;
  onEditingChange?: (editing: boolean) => void;
  onPanelFocusChange?: (focused: boolean) => void;
}) {
  return (
    <DeveloperPanels
      mainHeight={mainHeight}
      state={state}
      onEditingChange={onEditingChange}
      onPanelFocusChange={onPanelFocusChange}
    />
  );
}
