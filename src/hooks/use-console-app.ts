import { useApp, useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { getVisibleServices } from "../dev-services.ts";
import type { DaemonActionId } from "../lib/daemon-actions.ts";
import type { DaemonOperation } from "../lib/spinners.ts";
import { useVisibleServices } from "./use-visible-services.ts";

export type ActiveArea = "developer" | "services" | "provisioner";

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
    initialAutoInstall.shouldAutoInstall ? "provisioner" : "developer",
  );
  const [provisioning, setProvisioning] = useState(initialAutoInstall.shouldAutoInstall);
  const [selectedServiceIndex, setSelectedServiceIndex] = useState(
    initialAutoInstall.selectedServiceIndex,
  );
  const [daemonOperation, setDaemonOperation] = useState<DaemonOperation | null>(
    initialAutoInstall.shouldAutoInstall ? "install" : null,
  );
  const [installFinished, setInstallFinished] = useState(false);
  const [openServiceId, setOpenServiceId] = useState<string | null>(null);
  const { services: visibleServices, refresh: refreshServices } = useVisibleServices();
  const autoInstallStarted = useRef(initialAutoInstall.shouldAutoInstall);

  const startDaemonInstall = useCallback(() => {
    const index = visibleServices.findIndex((service) => service.id === "daemon");
    if (index >= 0) {
      setSelectedServiceIndex(index);
    }
    setActiveArea("provisioner");
    setProvisioning(true);
    setInstallFinished(false);
    setDaemonOperation("install");
  }, [visibleServices]);

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

  const handleOpenService = useCallback((serviceId: string) => {
    const index = visibleServices.findIndex((service) => service.id === serviceId);
    if (index >= 0) {
      setSelectedServiceIndex(index);
    }
    setOpenServiceId(serviceId);
  }, [visibleServices]);

  const handleDaemonAction = useCallback(async (action: DaemonActionId) => {
    switch (action) {
      case "install":
      case "repair":
        setActiveArea("provisioner");
        setProvisioning(true);
        setOpenServiceId(null);
        startDaemonInstall();
        return;
      case "restart":
        setActiveArea("services");
        setOpenServiceId(null);
        setInstallFinished(false);
        setDaemonOperation("restart");
        return;
      case "purge":
        setActiveArea("services");
        setOpenServiceId(null);
        setDaemonOperation("purge");
        return;
    }
  }, [startDaemonInstall]);

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
    setActiveArea("developer");
    setDaemonOperation(null);
    setInstallFinished(false);
    refreshServices();
  }, [refreshServices]);

  const handleRestartDone = useCallback(() => {
    setDaemonOperation(null);
    setInstallFinished(false);
    refreshServices();
  }, [refreshServices]);

  const handlePurgeDone = useCallback(() => {
    exit();
  }, [exit]);

  const handleCloseService = useCallback(() => {
    setOpenServiceId(null);
  }, []);

  useEffect(() => {
    setSelectedServiceIndex((index) =>
      Math.min(index, Math.max(0, visibleServices.length - 1)),
    );
  }, [visibleServices]);

  useEffect(() => {
    if (!openServiceId) {
      return;
    }
    if (!visibleServices.some((service) => service.id === openServiceId)) {
      setOpenServiceId(null);
    }
  }, [openServiceId, visibleServices]);

  useInput((_input, key) => {
    if (provisioning || openServiceId || daemonOperation) {
      return;
    }

    if (key.leftArrow) {
      setActiveArea((area) => (area === "services" ? "developer" : area));
    }
    if (key.rightArrow) {
      setActiveArea((area) => (area === "developer" ? "services" : area));
    }
  });

  return {
    activeArea,
    provisioning,
    selectedServiceIndex,
    visibleServices,
    openServiceId,
    daemonOperation,
    installFinished,
    handleOpenService,
    handleDaemonAction,
    handleProvisioningDone,
    handleInstallFinished,
    handleRestartDone,
    handlePurgeDone,
    handleCloseService,
    setSelectedServiceIndex,
  };
}
