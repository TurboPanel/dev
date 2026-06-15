import React, { useState } from "react";
import { Box, Text, useInput } from "@deno-ink/core";
import { broadcastToDaemon, formatEvent } from "@turbopanel/instance-client";
import type { DeveloperState } from "@turbopanel/use-developer-state";

export function ConnectivitySection({
  state,
  interactable = false,
  maxLines = 12,
}: {
  state: DeveloperState;
  interactable?: boolean;
  maxLines?: number;
}) {
  const { healthOk, connections, events, refresh } = state;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onBroadcast = async () => {
    setSending(true);
    setError(null);
    try {
      await broadcastToDaemon({ text: "ping", from: "console" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Broadcast failed");
    } finally {
      setSending(false);
    }
  };

  useInput((input, key) => {
    if (!interactable) return;
    if ((input === "b" || key.return) && healthOk && !sending) {
      void onBroadcast();
    }
  });

  return (
    <Box flexDirection="column">
      {error ? (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={error ? 1 : 0}>
        {events.length === 0 ? (
          <Text dimColor>Waiting for websocket traffic…</Text>
        ) : (
          [...events].reverse().slice(0, maxLines).map((event, index) => (
            <Text key={`${event.at}-${index}`} dimColor>
              {formatEvent(event, connections)}
            </Text>
          ))
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {interactable
            ? `b or Enter broadcast ping · Esc back${sending ? " …" : ""}`
            : "Enter to focus"}
        </Text>
      </Box>
    </Box>
  );
}
