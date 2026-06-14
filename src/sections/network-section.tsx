import React, { useState } from "react";
import { Box, Text, useInput } from "@deno-ink/core";
import {
  daemonLabel,
  fetchAllDaemonAddresses,
  fetchDaemonAddresses,
  fetchInstanceAddresses,
  type ServerAddressEntry,
  type ServerAddresses,
} from "@turbopanel/instance-client";
import { ALL_TARGET } from "@turbopanel/use-developer-state";
import type { DeveloperState } from "@turbopanel/use-developer-state";

function formatAddresses(addresses: ServerAddresses): string[] {
  const lines: string[] = [];
  if (addresses.privateIpv4.length) {
    lines.push(`  private IPv4: ${addresses.privateIpv4.join(", ")}`);
  }
  if (addresses.privateIpv6.length) {
    lines.push(`  private IPv6: ${addresses.privateIpv6.join(", ")}`);
  }
  if (addresses.publicIpv4.length) {
    lines.push(`  public IPv4: ${addresses.publicIpv4.join(", ")}`);
  }
  if (addresses.publicIpv6.length) {
    lines.push(`  public IPv6: ${addresses.publicIpv6.join(", ")}`);
  }
  if (lines.length === 0) lines.push("  (no addresses)");
  return lines;
}

export function NetworkSection({
  state,
  interactable = false,
}: {
  state: DeveloperState;
  interactable?: boolean;
}) {
  const { healthOk, connections, fleet, target } = state;
  const [fetching, setFetching] = useState(false);
  const [results, setResults] = useState<ServerAddressEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canFetch = healthOk === true &&
    (target === ALL_TARGET || fleet.some((c) => c.id === target));

  const onFetch = async () => {
    setFetching(true);
    setError(null);
    try {
      const entries: ServerAddressEntry[] = [];
      if (target === ALL_TARGET) {
        const [instance, daemons] = await Promise.all([
          fetchInstanceAddresses(),
          fetchAllDaemonAddresses(),
        ]);
        entries.push({
          source: instance.source,
          addresses: instance.addresses,
        });
        for (const server of daemons.servers) {
          entries.push({
            source: server.hostname?.trim() ||
              daemonLabel(server.daemonId, connections),
            addresses: server.addresses,
            error: server.error,
          });
        }
      } else {
        const response = await fetchDaemonAddresses(target);
        entries.push({
          source: response.hostname?.trim() ||
            daemonLabel(target, connections),
          addresses: response.addresses,
        });
      }
      setResults(entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch addresses");
    } finally {
      setFetching(false);
    }
  };

  useInput((input, key) => {
    if (!interactable) return;
    if (key.return && canFetch && !fetching) {
      void onFetch();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Network</Text>
      <Box marginTop={1}>
        <Text dimColor>
          Reads IPs assigned to physical interfaces only
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={canFetch ? "cyan" : "gray"}>
          Enter — Get IP addresses{fetching ? " …" : ""}
        </Text>
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      ) : null}
      {results ? (
        <Box flexDirection="column" marginTop={1}>
          {results.map((entry) => (
            <Box key={entry.source} flexDirection="column" marginBottom={1}>
              <Text bold>{entry.source}</Text>
              {entry.error ? (
                <Text color="red">{entry.error}</Text>
              ) : entry.addresses ? (
                formatAddresses(entry.addresses).map((line) => (
                  <Text key={line} dimColor>{line}</Text>
                ))
              ) : (
                <Text dimColor>(no data)</Text>
              )}
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
