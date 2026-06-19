import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { fetchServiceStatuses, type ServiceStatus } from "@turbopanel/lib/service-status.ts";

export function ServiceStatusSection() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await fetchServiceStatuses();
        if (!cancelled) {
          setServices(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load services");
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <Box flexDirection="column">
      <Text bold>Services</Text>
      <Text dimColor>{"─".repeat(40)}</Text>
      <Box marginTop={1}>
        <Text dimColor>
          systemd units, Postgres socket, and sockets under /run/turbopanel
        </Text>
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {services.map((service) => (
          <Box key={service.name} flexDirection="column" marginBottom={1}>
            <Box>
              <Text
                color={service.active === null
                  ? "yellow"
                  : service.active
                  ? "green"
                  : "red"}
              >
                ●{" "}
              </Text>
              <Text>{service.name}</Text>
              <Text dimColor> — {service.detail}</Text>
            </Box>
            {service.statusSummary ? (
              <Text dimColor>  {service.statusSummary}</Text>
            ) : null}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
