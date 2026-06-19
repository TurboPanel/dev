import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  isDaemonServiceActive,
  requestDaemonRestart,
  waitForDaemonRunning,
} from "../lib/daemon-actions.ts";
import { INSTALL_SPINNER_FRAMES } from "../lib/spinners.ts";
import {
  BORDER_COLOR,
  LIST_SELECT_BG,
  LIST_SELECT_FG,
  MENU_BLUE,
  MODAL_PANEL_BG,
  STATUS_RUNNING,
} from "../theme.ts";

type RestartPhase = "confirm" | "restarting" | "waiting" | "success" | "error";

const CONFIRM_OPTIONS = ["Yes", "No"] as const;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function RestartDaemonModal({
  width,
  height,
  onDone,
  onReady,
  onRefresh,
}: {
  width: number;
  height: number;
  onDone: () => void;
  onReady?: (success: boolean) => void;
  onRefresh?: () => void;
}) {
  const [spinnerIndex, setSpinnerIndex] = useState(0);
  const [phase, setPhase] = useState<RestartPhase>("confirm");
  const [confirmIndex, setConfirmIndex] = useState(1);
  const [confirmed, setConfirmed] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const modalWidth = Math.min(Math.max(28, width - 4), 52);
  const finished = phase === "success" || phase === "error";
  const inProgress = phase === "restarting" || phase === "waiting";
  const spinner = INSTALL_SPINNER_FRAMES[spinnerIndex];

  useEffect(() => {
    if (!inProgress) {
      return;
    }
    const timer = setInterval(() => {
      setSpinnerIndex((value) => (value + 1) % INSTALL_SPINNER_FRAMES.length);
    }, 120);
    return () => clearInterval(timer);
  }, [inProgress]);

  useEffect(() => {
    if (!confirmed) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        setPhase("restarting");
        await requestDaemonRestart();
        if (cancelled) {
          return;
        }

        setPhase("waiting");
        let lastElapsedMs = 0;
        const running = await waitForDaemonRunning({
          onPoll: (ms) => {
            if (cancelled) {
              return;
            }
            lastElapsedMs = ms;
            setElapsedMs(ms);
            onRefresh?.();
          },
        });

        if (cancelled) {
          return;
        }

        if (running) {
          setPhase("success");
          onRefresh?.();
          onReady?.(true);
        } else {
          setPhase("error");
          setError(
            `Daemon did not become active within ${formatElapsed(lastElapsedMs)}`,
          );
          onReady?.(false);
        }
      } catch (caught) {
        if (cancelled) {
          return;
        }
        const message = caught instanceof Error ? caught.message : String(caught);
        setPhase("error");
        setError(message);
        onReady?.(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [confirmed, onReady, onRefresh]);

  useInput((_input, key) => {
    if (phase === "confirm") {
      const lastIndex = CONFIRM_OPTIONS.length - 1;
      if (key.upArrow) {
        setConfirmIndex((index) => Math.max(0, index - 1));
      }
      if (key.downArrow) {
        setConfirmIndex((index) => Math.min(lastIndex, index + 1));
      }
      if (key.return) {
        if (CONFIRM_OPTIONS[confirmIndex] === "Yes") {
          setConfirmed(true);
        } else {
          onDone();
        }
      }
      if (key.escape) {
        onDone();
      }
      return;
    }
    if (!finished) {
      return;
    }
    if (key.return) {
      onDone();
    }
  });

  let statusLine: string;
  if (phase === "restarting") {
    statusLine = `${spinner} Sending restart request…`;
  } else if (phase === "waiting") {
    statusLine = `${spinner} Waiting for daemon (${formatElapsed(elapsedMs)})…`;
  } else if (phase === "success") {
    statusLine = "Daemon is running";
  } else {
    statusLine = error ?? "Restart failed";
  }

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
        <Text color={MENU_BLUE} bold>Restart daemon</Text>

        <Box marginTop={1} flexDirection="column">
          {phase === "confirm" ? (
            <Text wrap="wrap">Are you sure you want to restart?</Text>
          ) : phase === "success" ? (
            <Text color={STATUS_RUNNING}>{statusLine}</Text>
          ) : phase === "error" ? (
            <Text color="red" wrap="wrap">{statusLine}</Text>
          ) : (
            <Text>{statusLine}</Text>
          )}

          {phase === "waiting" && (
            <Box marginTop={1}>
              <Text dimColor>
                systemd: {isDaemonServiceActive() ? "active" : "not active yet"}
              </Text>
            </Box>
          )}
        </Box>

        {phase === "confirm" && (
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
        )}

        {finished && (
          <Box marginTop={1} flexDirection="row">
            <Box backgroundColor={LIST_SELECT_BG} paddingX={1}>
              <Text color={LIST_SELECT_FG} bold>OK</Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
