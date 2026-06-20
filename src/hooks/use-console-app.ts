import { useApp, useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { getVisibleServices } from "../dev-services.ts";
import type { DaemonActionId } from "../lib/daemon-actions.ts";
import {
  canRunServiceAction,
  runServiceAction,
  serviceActionForKey,
  type ServiceActionId,
} from "../lib/service-actions.ts";
import {
  type ConsoleLogLine,
  watchServiceRestart,
} from "../lib/service-restart.ts";
import { readInstanceRuntime } from "../lib/daemon-env.ts";
import type { DaemonOperation } from "../lib/spinners.ts";
import { refreshDevPermissionsQuietly } from "../lib/turbopanel-permissions.ts";
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

function initialAutoInstallState(): {
  shouldAutoInstall: boolean;
  selectedServiceIndex: number;
} {
  const services = getVisibleServices();
  const daemonIndex = services.findIndex((service) => service.id === "daemon");
  const daemon = daemonIndex >= 0 ? services[daemonIndex] : undefined;
  return {
    shouldAutoInstall: daemon?.status === "uninstalled",
    selectedServiceIndex: daemonIndex >= 0 ? daemonIndex : 0,
  };
}

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
    initialAutoInstall.shouldAutoInstall ? "install" : null,
  );
  const [installFinished, setInstallFinished] = useState(false);
  const [serviceOperation, setServiceOperation] = useState<ServiceOperation | null>(null);
  const [pendingRestart, setPendingRestart] = useState<PendingRestart | null>(null);
  const [restartInProgress, setRestartInProgress] = useState<string | null>(null);
  const [restartOverlayServiceId, setRestartOverlayServiceId] = useState<string | null>(null);
  const [restartLogOverlay, setRestartLogOverlay] = useState<ConsoleLogLine[]>([]);
  const [logFollowResetKey, setLogFollowResetKey] = useState(0);
  const { services: visibleServices, refresh: refreshServices } = useVisibleServices();
  const autoInstallStarted = useRef(initialAutoInstall.shouldAutoInstall);

  const startDaemonInstall = useCallback(() => {
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
    const daemon = visibleServices.find((service) => service.id === "daemon");
    if (daemon?.status === "uninstalled") {
      autoInstallStarted.current = true;
      startDaemonInstall();
    }
  }, [visibleServices, daemonOperation, startDaemonInstall]);

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
        setActiveArea("bootstrap");
        setProvisioning(true);
        setDaemonOperation("dev-env");
        return;
      }
    }
  }, [startDaemonInstall, visibleServices]);

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
    void performServiceRestart(serviceId);
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

  const handlePurgeDone = useCallback(() => {
    exit();
  }, [exit]);

  useEffect(() => {
    setSelectedServiceIndex((index) =>
      Math.min(index, Math.max(0, visibleServices.length - 1)),
    );
  }, [visibleServices]);

  useInput((_input, key) => {
    if (provisioning || daemonOperation || serviceOperation || pendingRestart || restartInProgress) {
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
    installFinished,
    handleDaemonAction,
    handleProvisioningDone,
    handleInstallFinished,
    handleServiceAction,
    handlePurgeDone,
    confirmServiceRestart,
    cancelServiceRestart,
    setSelectedServiceIndex,
    refreshServices,
  };
}
