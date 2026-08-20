import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  OPTIONAL_DEV_SERVICE_DEFS,
  OPTIONAL_SERVICES_AUTO_CONFIRM_SECONDS,
  type OptionalDevServiceId,
  type OptionalDevServiceSelection,
  cloneOptionalSelection,
} from "../lib/optional-dev-services.ts";
import {
  BORDER_COLOR,
  LIST_SELECT_BG,
  LIST_SELECT_FG,
  MENU_BLUE,
  MODAL_PANEL_BG,
} from "../theme.ts";

export type OptionalServicesModalMode = "converge" | "manage";

export function OptionalServicesModal({
  width,
  height,
  mode,
  initialSelection,
  onConfirm,
  onCancel,
}: Readonly<{
  width: number;
  height: number;
  mode: OptionalServicesModalMode;
  initialSelection: OptionalDevServiceSelection;
  onConfirm: (selection: OptionalDevServiceSelection) => void;
  onCancel: () => void;
}>) {
  const [selection, setSelection] = useState(() =>
    cloneOptionalSelection(initialSelection)
  );
  const [cursor, setCursor] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(
    mode === "converge" ? OPTIONAL_SERVICES_AUTO_CONFIRM_SECONDS : null,
  );
  const interacted = useRef(false);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const modalWidth = Math.min(Math.max(40, width - 4), 62);
  const lastIndex = OPTIONAL_DEV_SERVICE_DEFS.length - 1;

  useEffect(() => {
    if (mode !== "converge" || interacted.current) {
      return;
    }
    if (secondsLeft === null) {
      return;
    }
    if (secondsLeft <= 0) {
      onConfirm(selectionRef.current);
      return;
    }
    const timer = setTimeout(() => {
      setSecondsLeft((current) => (current === null ? null : current - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [mode, secondsLeft, onConfirm]);

  const markInteracted = () => {
    if (!interacted.current) {
      interacted.current = true;
      setSecondsLeft(null);
    }
  };

  useInput((input, key) => {
    markInteracted();

    if (key.upArrow) {
      setCursor((index) => Math.max(0, index - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((index) => Math.min(lastIndex, index + 1));
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      onConfirm(selectionRef.current);
      return;
    }
    if (input === " ") {
      const id = OPTIONAL_DEV_SERVICE_DEFS[cursor]?.id;
      if (!id) {
        return;
      }
      setSelection((current) => toggleService(current, id));
    }
  });

  return (
    <Box
      position="absolute"
      width={width}
      height={height}
      justifyContent="center"
      alignItems="center"
    >
      <Box
        borderStyle="round"
        borderColor={BORDER_COLOR}
        backgroundColor={MODAL_PANEL_BG}
        flexDirection="column"
        width={modalWidth}
        paddingX={1}
        paddingY={1}
      >
        <Text color={MENU_BLUE} bold>
          {mode === "converge" ? "Optional services" : "Manage optional services"}
        </Text>
        <Box marginTop={1}>
          <Text wrap="wrap" dimColor>
            {mode === "converge"
              ? "Core stack always starts. Toggle tooling to save RAM."
              : "Start or stop optional tooling without a full converge."}
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          {OPTIONAL_DEV_SERVICE_DEFS.map((def, index) => {
            const selected = index === cursor;
            const on = selection[def.id];
            const mark = on ? "[x]" : "[ ]";
            return (
              <Box
                key={def.id}
                flexDirection="column"
                backgroundColor={selected ? LIST_SELECT_BG : undefined}
                paddingX={selected ? 1 : 0}
                marginBottom={index === lastIndex ? 0 : 1}
              >
                <Text
                  color={selected ? LIST_SELECT_FG : undefined}
                  bold={selected}
                >
                  {mark} {def.label}
                </Text>
                <Text
                  color={selected ? LIST_SELECT_FG : undefined}
                  dimColor={!selected}
                >
                  {def.hint}
                </Text>
              </Box>
            );
          })}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            {secondsLeft === null
              ? "Space toggle · Enter confirm · Esc cancel"
              : `Continuing in ${secondsLeft}s · Space/↑↓ cancels timer`}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function toggleService(
  selection: OptionalDevServiceSelection,
  id: OptionalDevServiceId,
): OptionalDevServiceSelection {
  return { ...selection, [id]: !selection[id] };
}
