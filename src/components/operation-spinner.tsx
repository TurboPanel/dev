import React from "react";
import { Text } from "ink";
import {
  type DaemonOperation,
  spinnerFrames,
} from "../lib/spinners.ts";
import { useSpinnerFrame } from "../hooks/use-spinner-frame.ts";
import { MENU_BLUE, STATUS_UNINSTALLED } from "../theme.ts";

export function OperationSpinner({
  operation,
}: {
  operation: DaemonOperation;
}) {
  const frames = spinnerFrames(operation);
  const spinnerFrame = useSpinnerFrame(120);
  const index = spinnerFrame % frames.length;

  const color =
    operation === "purge" ? STATUS_UNINSTALLED : MENU_BLUE;

  return <Text color={color}>{frames[index]}</Text>;
}
