import React, { useCallback, useMemo, useState } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { readInstanceRuntime } from "@turbopanel/lib/instance-runtime.ts";
import { RuntimeBadge } from "@turbopanel/components/runtime-badge.tsx";
import { StatusLine } from "@turbopanel/components/status-line.tsx";

function systemctlIsActive(unit: string): { active: boolean | null; detail: string } {
  const proc = new Deno.Command("systemctl", {
    args: ["is-active", unit],
    stdout: "piped",
    stderr: "null",
  }).outputSync();

  const text = new TextDecoder().decode(proc.stdout).trim();
  if (proc.success && text === "active") {
    return { active: true, detail: "active" };
  }
  if (text === "inactive" || text === "failed") {
    return { active: false, detail: text };
  }
  if (text === "unknown" || proc.code === 4) {
    return { active: null, detail: "not installed" };
  }
  return { active: null, detail: text || `exit ${proc.code}` };
}

export function InstanceSection({
  onSwitch,
}: {
  onSwitch: (target: "deno" | "workers") => void;
}) {
  const [refreshKey, setRefreshKey] = useState(0);

  const runtime = useMemo(() => readInstanceRuntime(), [refreshKey]);
  const instanceUnit = useMemo(() => {
    void refreshKey;
    return systemctlIsActive("turbopanel-instance");
  }, [refreshKey]);

  const menuItems = useMemo(() => {
    const items: Array<{ label: string; value: string }> = [];

    if (runtime === "deno") {
      items.push({
        label: "Switch to Workers runtime",
        value: "switch-workers",
      });
    } else {
      items.push({
        label: "Switch to Deno runtime",
        value: "switch-deno",
      });
    }

    items.push({ label: "Refresh", value: "refresh" });
    return items;
  }, [runtime]);

  const refresh = useCallback(() => {
    setRefreshKey((count) => count + 1);
  }, []);

  const handleSelect = (item: { label: string; value: string }) => {
    if (item.value === "refresh") {
      refresh();
      return;
    }

    if (item.value === "switch-workers") {
      onSwitch("workers");
      return;
    }

    if (item.value === "switch-deno") {
      onSwitch("deno");
    }
  };

  return (
    <Box flexDirection="column">
      <Text bold>Instance Runtime</Text>
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text color={runtime === "deno" && instanceUnit.active !== true
            ? "yellow"
            : "green"}
          >
            {runtime === "deno" && instanceUnit.active !== true ? "○ " : "✓ "}
          </Text>
          <Text>runtime</Text>
          <Text dimColor> — </Text>
          <RuntimeBadge runtime={runtime} />
          <Text dimColor>
            {runtime === "workers"
              ? " (wrangler via systemd)"
              : " (systemd)"}
          </Text>
        </Box>
        {runtime === "workers" ? (
          <StatusLine
            label="wrangler dev"
            ok={instanceUnit.active === true}
            detail={instanceUnit.active === true
              ? "turbopanel-instance.service"
              : instanceUnit.detail}
          />
        ) : null}
        <StatusLine
          label="turbopanel-instance"
          ok={runtime === "workers" ? instanceUnit.active === true : instanceUnit.active === true}
          detail={instanceUnit.detail}
        />
      </Box>
      {runtime === "workers" ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="cyan">
            Run pnpm dev in platform/instance — no Redis, TCP postgres on :5432
          </Text>
          <Text color="cyan">
            Stop that terminal before switching back to Deno runtime.
          </Text>
          <Text dimColor>
            Update instance/.dev.vars:
            {" "}
            CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://turbopanel:
            {"<pass>"}
            @127.0.0.1:5432/turbopanel
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            Workers mode runs wrangler dev in a separate terminal (not managed by this console).
          </Text>
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        <SelectInput items={menuItems} onSelect={handleSelect} />
      </Box>
    </Box>
  );
}
