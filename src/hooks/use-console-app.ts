import { useApp, useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { getVisibleServices } from "../dev-services.ts";
import type { DaemonActionId } from "../lib/daemon-actions.ts";
import {
  canRunServiceAction,
  runServiceAction,
  type ServiceActionId,
} from "../lib/service-actions.ts";
import {
  type ConsoleLogLine,
  consoleLogLine,
  watchServiceRestart,
} from "../lib/service-restart.ts";
import { readInstanceRuntime } from "../lib/daemon-env.ts";
import { resolveDevEnvStartupPlan } from "../lib/dev-env-readiness.ts";
import {
  readCellTraceEnabled,
  setCellTraceEnabled,
} from "../lib/instance-trace-env.ts";
import type { DaemonLogByteFloor } from "../lib/daemon-log.ts";
import { readDaemonLogFileStat } from "../lib/daemon-log.ts";
import { watchInstanceRuntimeSwitch } from "../lib/instance-runtime.ts";
import type { ServiceLogByteFloor } from "../lib/service-log.ts";
import { readServiceLogFileStat } from "../lib/service-log.ts";
import type { DaemonOperation } from "../lib/spinners.ts";
import { refreshDevPermissionsQuietly } from "../lib/turbopanel-permissions.ts";
import { useDevEnvConverge } from "./use-dev-env-converge.ts";
import { useVisibleServices } from "./use-visible-services.ts";

export type ActiveArea = "developer" | "services" | "bootstrap";

export type ServiceOperation = {
  serviceId: string;
  action: ServiceActionId;
};

export type PendingRestart = {
  serviceId: string;
  label: string;
};

function initialDaemonOperation(
  shouldAutoInstall: boolean,
  shouldAutoConverge: boolean,
): DaemonOperation | null {
  if (shouldAutoInstall) {
    return "install";
  }
  if (shouldAutoConverge) {
    return "dev-env";
  }
  return null;
}

function initialAutoInstallState(): {
  shouldAutoInstall: boolean;
  shouldAutoConverge: boolean;
  selectedServiceIndex: number;
} {
  const plan = resolveDevEnvStartupPlan();
  return {
    shouldAutoInstall: plan.action === "bootstrap",
    shouldAutoConverge: plan.action === "converge",
    selectedServiceIndex: 0,
  };
}

export type DeveloperView = "menu" | "cell-trace";

export function useConsoleApp() {
  const { exit } = useApp();
  const initialAutoInstall = initialAutoInstallState();
  const [activeArea, setActiveArea] = useState<ActiveArea>(
    initialAutoInstall.shouldAutoInstall ? "bootstrap" : "services",
  );
  const [provisioning, setProvisioning] = useState(initialAutoInstall.shouldAutoInstall);
  const [selectedServiceIndex, setSelectedServiceIndex] = useState(
    initialAutoInstall.selectedServiceIndex,
  );
  const [daemonOperation, setDaemonOperation] = useState<DaemonOperation | null>(
    initialDaemonOperation(
      initialAutoInstall.shouldAutoInstall,
      initialAutoInstall.shouldAutoConverge,
    ),
  );
  const [installFinished, setInstallFinished] = useState(false);
  const [serviceOperation, setServiceOperation] = useState<ServiceOperation | null>(null);
  const [pendingRestart, setPendingRestart] = useState<PendingRestart | null>(null);
  const [restartInProgress, setRestartInProgress] = useState<string | null>(null);
  const [restartOverlayServiceId, setRestartOverlayServiceId] = useState<string | null>(null);
  const [restartLogOverlay, setRestartLogOverlay] = useState<ConsoleLogLine[]>([]);
  const [logFollowResetKey, setLogFollowResetKey] = useState(0);
  const [daemonLogByteFloor, setDaemonLogByteFloor] = useState<DaemonLogByteFloor | null>(
    null,
  );
  const [instanceLogByteFloor, setInstanceLogByteFloor] = useState<ServiceLogByteFloor | null>(
    null,
  );
  const [developerView, setDeveloperView] = useState<DeveloperView>("menu");
  const { services: visibleServices, refresh: refreshServices } = useVisibleServices();
  const autoInstallStarted = useRef(initialAutoInstall.shouldAutoInstall);
  const autoConvergeStarted = useRef(false);
  const shouldAutoConvergeOnLaunch = useRef(initialAutoInstall.shouldAutoConverge);
  const devEnvConvergeSelectionPinned = useRef(false);
  const selectedServiceIdRef = useRef(
    getVisibleServices()[initialAutoInstall.selectedServiceIndex]?.id ?? "daemon",
  );

  const handleDevEnvConvergeFinished = useCallback((success: boolean) => {
    if (success) {
      setProvisioning(false);
      setActiveArea("services");
      setDaemonOperation(null);
      setInstallFinished(false);
      refreshServices();
      return;
    }
    setDaemonOperation(null);
    refreshServices();
  }, [refreshServices]);

  const { state: devEnvConverge, start: startDevEnvConverge, dismissError: dismissDevEnvConvergeError } =
    useDevEnvConverge(handleDevEnvConvergeFinished);

  const startDaemonInstall = useCallback(() => {
    selectedServiceIdRef.current = "daemon";
    const index = visibleServices.findIndex((service) => service.id === "daemon");
    if (index >= 0) {
      setSelectedServiceIndex(index);
    }
    setActiveArea("bootstrap");
    setProvisioning(true);
    setInstallFinished(false);
    setDaemonOperation("install");
  }, [visibleServices]);

  useEffect(() => {
    refreshDevPermissionsQuietly();
  }, []);

  useEffect(() => {
    if (autoInstallStarted.current || daemonOperation) {
      return;
    }
    const plan = resolveDevEnvStartupPlan();
    if (plan.action === "bootstrap") {
      autoInstallStarted.current = true;
      startDaemonInstall();
    }
  }, [visibleServices, daemonOperation, startDaemonInstall]);

  useEffect(() => {
    if (
      !shouldAutoConvergeOnLaunch.current ||
      autoConvergeStarted.current ||
      autoInstallStarted.current
    ) {
      return;
    }
    autoConvergeStarted.current = true;
    setActiveArea("services");
    setProvisioning(false);
    setDaemonOperation("dev-env");
    startDevEnvConverge("if-needed");
  }, [startDevEnvConverge]);

  const restartInstanceWithOverlay = useCallback(async () => {
    const service = visibleServices.find((entry) => entry.id === "instance");
    const label = service?.label ?? "instance";

    setRestartInProgress("instance");
    setRestartOverlayServiceId("instance");
    setRestartLogOverlay([]);
    setInstanceLogByteFloor(readServiceLogFileStat("instance"));

    const appendLog = (line: ConsoleLogLine) => {
      setRestartLogOverlay((current) => [...current, line]);
    };

    try {
      await watchServiceRestart("instance", label, appendLog);
    } finally {
      setRestartInProgress(null);
      setRestartOverlayServiceId(null);
      setRestartLogOverlay([]);
      setLogFollowResetKey((key) => key + 1);
      refreshServices();
    }
  }, [refreshServices, visibleServices]);

  const handleDaemonAction = useCallback(async (action: DaemonActionId) => {
    switch (action) {
      case "install":
      case "repair":
        setActiveArea("bootstrap");
        setProvisioning(true);
        startDaemonInstall();
        return;
      case "purge":
        setActiveArea("developer");
        setDaemonOperation("purge");
        return;
      case "start-dev-env": {
        const daemon = visibleServices.find((service) => service.id === "daemon");
        if (!daemon || daemon.status === "uninstalled") {
          throw new Error(
            "Install the daemon before starting the development environment.",
          );
        }
        setInstallFinished(false);
        setActiveArea("services");
        setProvisioning(false);
        setDaemonOperation("dev-env");
        startDevEnvConverge("force");
        return;
      }
      case "reset-dev-env": {
        const daemon = visibleServices.find((service) => service.id === "daemon");
        if (!daemon || daemon.status === "uninstalled") {
          throw new Error(
            "Install the daemon before resetting the development environment.",
          );
        }
        setInstallFinished(false);
        setActiveArea("bootstrap");
        setProvisioning(true);
        setDaemonOperation("reset-dev-env");
        return;
      }
      case "reset-dev-db": {
        const daemon = visibleServices.find((service) => service.id === "daemon");
        if (!daemon || daemon.status === "uninstalled") {
          throw new Error(
            "Install the daemon before resetting the dev database.",
          );
        }
        setInstallFinished(false);
        setActiveArea("bootstrap");
        setProvisioning(true);
        setDaemonOperation("reset-dev-db");
        return;
      }
      case "sync-dev-build":
        setInstallFinished(false);
        setActiveArea("bootstrap");
        setProvisioning(true);
        setDaemonOperation("sync-dev-build");
        return;
      case "toggle-cell-trace":
        setActiveArea("developer");
        setCellTraceEnabled(!readCellTraceEnabled());
        await restartInstanceWithOverlay();
        return;
      case "view-cell-trace":
        setDeveloperView("cell-trace");
        return;
    }
  }, [restartInstanceWithOverlay, startDaemonInstall, startDevEnvConverge, visibleServices]);

  const requestServiceRestart = useCallback((serviceId: string) => {
    const service = visibleServices.find((entry) => entry.id === serviceId);
    if (!service) {
      return;
    }
    setPendingRestart({ serviceId, label: service.label });
  }, [visibleServices]);

  const cancelServiceRestart = useCallback(() => {
    setPendingRestart(null);
  }, []);

  const performServiceRestart = useCallback(async (serviceId: string) => {
    const service = visibleServices.find((entry) => entry.id === serviceId);
    if (!service) {
      return;
    }

    setRestartInProgress(serviceId);
    setRestartOverlayServiceId(serviceId);
    setRestartLogOverlay([]);

    if (serviceId === "daemon") {
      const stat = readDaemonLogFileStat();
      setDaemonLogByteFloor({
        stdout: stat.stdoutSize,
        stderr: stat.stderrSize,
      });
    }

    const appendLog = (line: ConsoleLogLine) => {
      setRestartLogOverlay((current) => [...current, line]);
    };

    try {
      await watchServiceRestart(serviceId, service.label, appendLog);
    } finally {
      setRestartInProgress(null);
      setRestartOverlayServiceId(null);
      setRestartLogOverlay([]);
      setLogFollowResetKey((key) => key + 1);
      refreshServices();
    }
  }, [refreshServices, visibleServices]);

  const confirmServiceRestart = useCallback(() => {
    if (!pendingRestart) {
      return;
    }
    const { serviceId } = pendingRestart;
    setPendingRestart(null);
    performServiceRestart(serviceId).catch(() => undefined);
  }, [pendingRestart, performServiceRestart]);

  const handleServiceAction = useCallback(async (
    serviceId: string,
    action: ServiceActionId,
  ) => {
    if (action === "restart") {
      requestServiceRestart(serviceId);
      return;
    }

    const service = visibleServices.find((entry) => entry.id === serviceId);
    if (!service) {
      return;
    }

    const runtime = readInstanceRuntime();
    if (!canRunServiceAction(serviceId, action, service.status, runtime)) {
      return;
    }

    if (action === "switch-workers" || action === "switch-deno") {
      const target = action === "switch-workers" ? "workers" : "deno";
      const from = runtime;
      if (from === target) {
        return;
      }

      setRestartInProgress(`instance (${from} → ${target})`);
      setRestartOverlayServiceId("instance");
      setRestartLogOverlay([]);
      setInstanceLogByteFloor(readServiceLogFileStat("instance"));

      const appendLog = (line: ConsoleLogLine) => {
        setRestartLogOverlay((current) => [...current, line]);
      };

      try {
        await watchInstanceRuntimeSwitch(target, from, appendLog);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendLog(consoleLogLine(`[console] Runtime switch failed: ${message}`));
      } finally {
        setRestartInProgress(null);
        setRestartOverlayServiceId(null);
        setRestartLogOverlay([]);
        setLogFollowResetKey((key) => key + 1);
        refreshServices();
      }
      return;
    }

    setServiceOperation({ serviceId, action });
    try {
      await runServiceAction(serviceId, action);
      refreshServices();
    } finally {
      setServiceOperation(null);
    }
  }, [refreshServices, requestServiceRestart, visibleServices]);

  const handleInstallFinished = useCallback((success: boolean) => {
    setInstallFinished(true);
    refreshServices();
    if (success) {
      let attempts = 0;
      const id = setInterval(() => {
        refreshServices();
        attempts += 1;
        if (attempts >= 6) {
          clearInterval(id);
        }
      }, 500);
    }
  }, [refreshServices]);

  const handleProvisioningDone = useCallback(() => {
    setProvisioning(false);
    setActiveArea("services");
    setDaemonOperation(null);
    setInstallFinished(false);
    refreshServices();
  }, [refreshServices]);

  const handleDaemonInstallDone = useCallback(() => {
    setActiveArea("services");
    setProvisioning(false);
    setDaemonOperation("dev-env");
    startDevEnvConverge("if-needed");
  }, [startDevEnvConverge]);

  const handlePurgeDone = useCallback(() => {
    exit();
  }, [exit]);

  useEffect(() => {
    const inDevEnvConverge =
      daemonOperation === "dev-env" || devEnvConverge.active;

    if (inDevEnvConverge) {
      if (!devEnvConvergeSelectionPinned.current) {
        devEnvConvergeSelectionPinned.current = true;
        const daemonIndex = visibleServices.findIndex(
          (service) => service.id === "daemon",
        );
        if (daemonIndex >= 0) {
          selectedServiceIdRef.current = "daemon";
          setSelectedServiceIndex(daemonIndex);
        }
      }
      return;
    }

    devEnvConvergeSelectionPinned.current = false;

    const preservedIndex = visibleServices.findIndex(
      (service) => service.id === selectedServiceIdRef.current,
    );
    if (preservedIndex >= 0) {
      setSelectedServiceIndex(preservedIndex);
      return;
    }

    setSelectedServiceIndex((index) =>
      Math.min(index, Math.max(0, visibleServices.length - 1)),
    );
  }, [visibleServices, daemonOperation, devEnvConverge.active]);

  const setSelectedServiceIndexById = useCallback((index: number) => {
    const service = visibleServices[index];
    if (service) {
      selectedServiceIdRef.current = service.id;
    }
    setSelectedServiceIndex(index);
  }, [visibleServices]);

  const closeCellTraceView = useCallback(() => {
    setDeveloperView("menu");
  }, []);

  useInput((_input, key) => {
    if (provisioning || daemonOperation || serviceOperation || pendingRestart || restartInProgress) {
      return;
    }

    if (developerView === "cell-trace") {
      return;
    }

    if (key.leftArrow) {
      setActiveArea((area) => (area === "developer" ? "services" : area));
    }
    if (key.rightArrow) {
      setActiveArea((area) => (area === "services" ? "developer" : area));
    }
  });

  const selectedService = visibleServices[selectedServiceIndex] ?? null;

  return {
    activeArea,
    provisioning,
    selectedServiceIndex,
    selectedService,
    visibleServices,
    daemonOperation,
    serviceOperation,
    pendingRestart,
    restartInProgress,
    restartOverlayServiceId,
    restartLogOverlay,
    logFollowResetKey,
    daemonLogByteFloor,
    instanceLogByteFloor,
    installFinished,
    handleDaemonAction,
    handleProvisioningDone,
    handleDaemonInstallDone,
    handleInstallFinished,
    handleServiceAction,
    handlePurgeDone,
    devEnvConverge,
    dismissDevEnvConvergeError,
    confirmServiceRestart,
    cancelServiceRestart,
    developerView,
    closeCellTraceView,
    setSelectedServiceIndex: setSelectedServiceIndexById,
    refreshServices,
  };
}
