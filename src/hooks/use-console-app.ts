import { useApp, useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { AREAS } from "../app.tsx";
import type { DaemonActionId } from "../lib/daemon-actions.ts";
import type { DaemonOperation } from "../lib/spinners.ts";
import { useVisibleServices } from "./use-visible-services.ts";

export function useConsoleApp(areas: typeof AREAS = AREAS) {
  const { exit } = useApp();
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedServiceIndex, setSelectedServiceIndex] = useState(0);
  const [daemonOperation, setDaemonOperation] = useState<DaemonOperation | null>(null);
  const [installFinished, setInstallFinished] = useState(false);
  const [openServiceId, setOpenServiceId] = useState<string | null>(null);
  const { services: visibleServices, refresh: refreshServices } = useVisibleServices();
  const autoInstallStarted = useRef(false);

  const startDaemonInstall = useCallback(() => {
    const index = visibleServices.findIndex((service) => service.id === "daemon");
    if (index >= 0) {
      setSelectedServiceIndex(index);
    }
    setOpenServiceId("daemon");
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
        startDaemonInstall();
        return;
      case "restart":
        setOpenServiceId("daemon");
        setInstallFinished(false);
        setDaemonOperation("restart");
        return;
      case "purge":
        setOpenServiceId("daemon");
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

  const handleDaemonOperationDone = useCallback(() => {
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
    if (daemonOperation || openServiceId) {
      return;
    }

    if (key.leftArrow) {
      setActiveIndex((index) => Math.max(0, index - 1));
    }
    if (key.rightArrow) {
      setActiveIndex((index) => Math.min(areas.length - 1, index + 1));
    }
  });

  return {
    activeIndex,
    selectedServiceIndex,
    visibleServices,
    openServiceId,
    daemonOperation,
    installFinished,
    handleOpenService,
    handleDaemonAction,
    handleDaemonOperationDone,
    handleInstallFinished,
    handlePurgeDone,
    handleCloseService,
    setSelectedServiceIndex,
  };
}
