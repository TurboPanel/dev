import React from "react";
import { render, useWindowSize } from "ink";
import { AppView } from "./app.tsx";
import { useConsoleApp } from "./hooks/use-console-app.ts";

function App() {
  const { columns, rows } = useWindowSize();
  const consoleApp = useConsoleApp();

  return (
    <AppView
      activeIndex={consoleApp.activeIndex}
      columns={columns}
      rows={rows}
      selectedServiceIndex={consoleApp.selectedServiceIndex}
      visibleServices={consoleApp.visibleServices}
      openServiceId={consoleApp.openServiceId}
      daemonOperation={consoleApp.daemonOperation}
      installFinished={consoleApp.installFinished}
      onDaemonOperationDone={consoleApp.handleDaemonOperationDone}
      onInstallFinished={consoleApp.handleInstallFinished}
      onPurgeDone={consoleApp.handlePurgeDone}
      onOpenService={consoleApp.handleOpenService}
      onCloseService={consoleApp.handleCloseService}
      onDaemonAction={consoleApp.openServiceId === "daemon" ? consoleApp.handleDaemonAction : undefined}
      onSelectedServiceIndexChange={consoleApp.setSelectedServiceIndex}
    />
  );
}

const { waitUntilExit } = render(<App />, {
  alternateScreen: true,
  exitOnCtrlC: true,
  patchConsole: true,
});

await waitUntilExit();
