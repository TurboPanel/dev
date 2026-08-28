import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  LIST_SELECT_BG,
  LIST_SELECT_FG,
  MODAL_PANEL_BG,
  STATUS_UNINSTALLED,
} from "../theme.ts";

const CONFIRM_OPTIONS = ["Yes", "Cancel"] as const;
// Destructive actions default to Cancel so a stray Enter is harmless.
const DEFAULT_OPTION_INDEX = CONFIRM_OPTIONS.indexOf("Cancel");

export function ConfirmDangerModal({
  width,
  height,
  title,
  warning,
  onConfirm,
  onCancel,
}: Readonly<{
  width: number;
  height: number;
  title: string;
  warning: string;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  const [confirmIndex, setConfirmIndex] = useState(DEFAULT_OPTION_INDEX);
  const modalWidth = Math.min(Math.max(32, width - 4), 60);

  useInput((_input, key) => {
    const lastIndex = CONFIRM_OPTIONS.length - 1;
    if (key.upArrow) {
      setConfirmIndex((index) => Math.max(0, index - 1));
    }
    if (key.downArrow) {
      setConfirmIndex((index) => Math.min(lastIndex, index + 1));
    }
    if (key.return) {
      if (CONFIRM_OPTIONS[confirmIndex] === "Yes") {
        onConfirm();
      } else {
        onCancel();
      }
    }
    if (key.escape) {
      onCancel();
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
        borderColor={STATUS_UNINSTALLED}
        backgroundColor={MODAL_PANEL_BG}
        flexDirection="column"
        width={modalWidth}
        paddingX={1}
        paddingY={1}
      >
        <Text color={STATUS_UNINSTALLED} bold>{title}</Text>

        <Box marginTop={1}>
          <Text wrap="wrap">{warning}</Text>
        </Box>

        <Box marginTop={1}>
          <Text color={STATUS_UNINSTALLED} wrap="wrap">
            This cannot be undone. Continue?
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          {CONFIRM_OPTIONS.map((option, index) => {
            const selected = index === confirmIndex;
            return (
              <Box
                key={option}
                backgroundColor={selected ? LIST_SELECT_BG : undefined}
                paddingX={selected ? 1 : 0}
              >
                <Text color={selected ? LIST_SELECT_FG : undefined} bold={selected}>
                  {option}
                </Text>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
