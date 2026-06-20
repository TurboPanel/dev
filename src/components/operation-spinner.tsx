import React, { useEffect, useState } from "react";
import { Text } from "ink";
import {
  type DaemonOperation,
  spinnerFrames,
} from "../lib/spinners.ts";
import { MENU_BLUE, STATUS_UNINSTALLED } from "../theme.ts";

export function OperationSpinner({
  operation,
}: {
  operation: DaemonOperation;
}) {
  const frames = spinnerFrames(operation);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((value) => (value + 1) % frames.length);
    }, 120);
    return () => clearInterval(timer);
  }, [frames.length]);

  const color =
    operation === "purge" ? STATUS_UNINSTALLED : MENU_BLUE;

  return <Text color={color}>{frames[index]}</Text>;
}
