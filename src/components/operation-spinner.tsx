import React, { useEffect, useState } from "react";
import { Text } from "ink";
import {
  type DaemonOperation,
  spinnerFrames,
} from "../lib/spinners.ts";
import { LIST_OPEN_FG, MENU_BLUE, STATUS_UNINSTALLED } from "../theme.ts";

export function OperationSpinner({
  operation,
  dimmed = false,
  highlighted = false,
}: {
  operation: DaemonOperation;
  dimmed?: boolean;
  highlighted?: boolean;
}) {
  const frames = spinnerFrames(operation);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((value) => (value + 1) % frames.length);
    }, 120);
    return () => clearInterval(timer);
  }, [frames.length]);

  const color = highlighted
    ? LIST_OPEN_FG
    : operation === "purge"
    ? STATUS_UNINSTALLED
    : MENU_BLUE;

  return (
    <Text color={dimmed ? undefined : color} dimColor={dimmed}>
      {frames[index]}
    </Text>
  );
}
