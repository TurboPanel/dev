import React from "react";
import { useWindowSize } from "ink";
import { AppView } from "./app.tsx";
import { useConsoleApp } from "./hooks/use-console-app.ts";

export function ConsoleApp() {
  const { columns, rows } = useWindowSize();
  const consoleApp = useConsoleApp();

  return (
    <AppView
      activeArea={consoleApp.activeArea}
      provisioning={consoleApp.provisioning}
      installFinished={consoleApp.installFinished}
      columns={columns}
      rows={rows}
      selectedServiceIndex={consoleApp.selectedServiceIndex}
      selectedServiceId={consoleApp.selectedService?.id ?? null}
      visibleServices={consoleApp.visibleServices}
      daemonOperation={consoleApp.daemonOperation}
      onProvisioningDone={consoleApp.handleProvisioningDone}
      onInstallFinished={consoleApp.handleInstallFinished}
      onDaemonInstallDone={consoleApp.handleDaemonInstallDone}
      onPurgeDone={consoleApp.handlePurgeDone}
      onDaemonAction={consoleApp.handleDaemonAction}
      onDeveloperDaemonAction={consoleApp.handleDaemonAction}
      onSelectedServiceIndexChange={consoleApp.setSelectedServiceIndex}
      onRefreshServices={consoleApp.refreshServices}
      serviceOperation={consoleApp.serviceOperation}
      onServiceAction={consoleApp.handleServiceAction}
      pendingRestart={consoleApp.pendingRestart}
      restartInProgress={consoleApp.restartInProgress}
      restartOverlayServiceId={consoleApp.restartOverlayServiceId}
      restartLogOverlay={consoleApp.restartLogOverlay}
      logFollowResetKey={consoleApp.logFollowResetKey}
      onConfirmRestart={consoleApp.confirmServiceRestart}
      onCancelRestart={consoleApp.cancelServiceRestart}
      devEnvConverge={consoleApp.devEnvConverge}
      onDismissDevEnvConvergeError={consoleApp.dismissDevEnvConvergeError}
    />
  );
}
