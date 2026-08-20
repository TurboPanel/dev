import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  BORDER_COLOR,
  LIST_SELECT_BG,
  LIST_SELECT_FG,
  MENU_BLUE,
  MODAL_PANEL_BG,
} from "../theme.ts";

const CONFIRM_OPTIONS = ["Yes", "No"] as const;

export function RestartServiceModal({
  width,
  height,
  serviceLabel,
  onConfirm,
  onCancel,
}: Readonly<{
  width: number;
  height: number;
  serviceLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  const [confirmIndex, setConfirmIndex] = useState(0);
  const modalWidth = Math.min(Math.max(28, width - 4), 52);

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
        borderColor={BORDER_COLOR}
        backgroundColor={MODAL_PANEL_BG}
        flexDirection="column"
        width={modalWidth}
        paddingX={1}
        paddingY={1}
      >
        <Text color={MENU_BLUE} bold>Restart {serviceLabel}</Text>

        <Box marginTop={1}>
          <Text wrap="wrap">Are you sure you want to restart?</Text>
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
