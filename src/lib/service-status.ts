export type ServiceStatus = {
  name: string;
  active: boolean | null;
  detail: string;
  statusSummary?: string;
};

const TURBOPANEL_RUN_DIR = "/run/turbopanel";
const POSTGRES_SOCKET = "/var/run/turbopanel/postgres/.s.PGSQL.5432";

function formatSystemctlShow(output: string): string {
  const props: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      props[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }

  const parts: string[] = [];
  const state = props.ActiveState;
  const sub = props.SubState;
  if (state) {
    parts.push(sub && sub !== state ? `${state} (${sub})` : state);
  }
  if (props.Description) parts.push(props.Description);
  if (props.MainPID && props.MainPID !== "0") {
    parts.push(`pid=${props.MainPID}`);
  }
  if (props.Result && props.Result !== "success") {
    parts.push(`result=${props.Result}`);
  }
  if (props.ExecMainCode && props.ExecMainCode !== "0") {
    parts.push(`exit=${props.ExecMainCode}`);
  }
  return parts.join(" · ") || "unknown";
}

async function systemctlUnitStatus(unit: string): Promise<ServiceStatus> {
  const activeCmd = new Deno.Command("systemctl", {
    args: ["is-active", unit],
    stdout: "piped",
    stderr: "null",
  });
  const showCmd = new Deno.Command("systemctl", {
    args: [
      "show",
      unit,
      "--property=ActiveState,SubState,MainPID,Result,ExecMainCode,Description",
      "--no-pager",
    ],
    stdout: "piped",
    stderr: "null",
  });

  const [activeResult, showResult] = await Promise.all([
    activeCmd.output(),
    showCmd.output(),
  ]);

  const activeText = new TextDecoder().decode(activeResult.stdout).trim();
  const showText = new TextDecoder().decode(showResult.stdout).trim();
  const statusSummary = showText ? formatSystemctlShow(showText) : "";

  if (activeResult.code === 0 && activeText === "active") {
    return {
      name: unit,
      active: true,
      detail: "active",
      statusSummary,
    };
  }
  if (activeText === "inactive" || activeText === "failed") {
    return {
      name: unit,
      active: false,
      detail: activeText,
      statusSummary,
    };
  }
  if (activeText === "unknown" || showResult.code !== 0) {
    return {
      name: unit,
      active: null,
      detail: "unit not installed",
      statusSummary,
    };
  }
  return {
    name: unit,
    active: null,
    detail: activeText || `exit ${activeResult.code}`,
    statusSummary,
  };
}

function isPermissionDenied(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return message.includes("permission denied") || message.includes("not permitted");
}

async function postgresSocketStatus(): Promise<ServiceStatus> {
  try {
    const stat = await Deno.stat(POSTGRES_SOCKET);
    if (stat.isSocket) {
      return {
        name: "turbopanel-db",
        active: true,
        detail: "socket ready",
        statusSummary: POSTGRES_SOCKET,
      };
    }
    return {
      name: "turbopanel-db",
      active: null,
      detail: "unexpected socket path type",
      statusSummary: POSTGRES_SOCKET,
    };
  } catch (err) {
    if (isPermissionDenied(err)) {
      return {
        name: "turbopanel-db",
        active: null,
        detail: "permission denied",
        statusSummary: POSTGRES_SOCKET,
      };
    }
    return {
      name: "turbopanel-db",
      active: false,
      detail: "socket missing",
      statusSummary: POSTGRES_SOCKET,
    };
  }
}

async function listTurbopanelSockets(): Promise<ServiceStatus[]> {
  const sockets: string[] = [];

  try {
    for await (const entry of Deno.readDir(TURBOPANEL_RUN_DIR)) {
      try {
        const stat = await Deno.stat(`${TURBOPANEL_RUN_DIR}/${entry.name}`);
        if (stat.isSocket) {
          sockets.push(entry.name);
        }
      } catch (err) {
        if (isPermissionDenied(err)) {
          return [{
            name: TURBOPANEL_RUN_DIR,
            active: null,
            detail: "permission denied",
          }];
        }
      }
    }
  } catch (err) {
    if (isPermissionDenied(err)) {
      return [{
        name: TURBOPANEL_RUN_DIR,
        active: null,
        detail: "permission denied",
      }];
    }
    const message = err instanceof Error ? err.message : String(err);
    return [{
      name: TURBOPANEL_RUN_DIR,
      active: false,
      detail: "directory missing or unreadable",
      statusSummary: message,
    }];
  }

  sockets.sort();

  if (sockets.length === 0) {
    return [{
      name: TURBOPANEL_RUN_DIR,
      active: null,
      detail: "no sockets present",
    }];
  }

  return sockets.map((socketName) => ({
    name: socketName,
    active: true,
    detail: `${TURBOPANEL_RUN_DIR}/${socketName}`,
  }));
}

export async function fetchServiceStatuses(): Promise<ServiceStatus[]> {
  const units = [
    "turbopanel-instance",
    "turbopanel-caddy",
    "turbopanel-ui",
    "turbopanel-daemon",
    "turbopanel-redis",
    "turbopanel-rabbitmq",
  ];

  const [unitResults, postgresResult, socketResults] = await Promise.all([
    Promise.all(units.map((unit) => systemctlUnitStatus(unit))),
    postgresSocketStatus(),
    listTurbopanelSockets(),
  ]);

  return [...unitResults, postgresResult, ...socketResults];
}
