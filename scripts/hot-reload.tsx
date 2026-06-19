import { fileURLToPath } from "node:url";
import React, { useEffect, useState } from "react";
import { render, useWindowSize } from "ink";
import { createServer, normalizePath, type ViteDevServer } from "vite";
import type { AppView as AppViewComponent, AREAS as AppAreas } from "../src/app.tsx";
import { useConsoleApp } from "../src/hooks/use-console-app.ts";

type AppModule = {
  AppView: typeof AppViewComponent;
  AREAS: typeof AppAreas;
};

const ENTRY = "/src/app.tsx";
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const configFile = fileURLToPath(new URL("../vite.config.ts", import.meta.url));

async function loadAppModule(server: ViteDevServer): Promise<AppModule> {
  server.moduleGraph.invalidateAll();
  return await server.ssrLoadModule(`${ENTRY}?t=${Date.now()}`) as AppModule;
}

function HotReloadApp({
  server,
  initialModule,
}: {
  server: ViteDevServer;
  initialModule: AppModule;
}) {
  const { columns, rows } = useWindowSize();
  const [appModule, setAppModule] = useState(initialModule);
  const consoleApp = useConsoleApp();

  useEffect(() => {
    let timeout: NodeJS.Timeout | undefined;
    let disposed = false;

    const reload = () => {
      clearTimeout(timeout);
      timeout = setTimeout(async () => {
        try {
          const nextModule = await loadAppModule(server);
          if (!disposed) setAppModule(nextModule);
        } catch (error) {
          process.stderr.write(`${String(error)}\n`);
        }
      }, 50);
    };

    const shouldReload = (path: string) => {
      const normalized = normalizePath(path);
      return normalized.startsWith(normalizePath(`${repoRoot}/src/`));
    };

    const onChange = (path: string) => {
      if (shouldReload(path)) reload();
    };

    server.watcher.on("change", onChange);
    server.watcher.on("add", onChange);
    server.watcher.on("unlink", onChange);

    return () => {
      disposed = true;
      clearTimeout(timeout);
      server.watcher.off("change", onChange);
      server.watcher.off("add", onChange);
      server.watcher.off("unlink", onChange);
    };
  }, [server]);

  const AppView = appModule.AppView;
  return (
    <AppView
      activeArea={consoleApp.activeArea}
      provisioning={consoleApp.provisioning}
      installFinished={consoleApp.installFinished}
      columns={columns}
      rows={rows}
      selectedServiceIndex={consoleApp.selectedServiceIndex}
      visibleServices={consoleApp.visibleServices}
      openServiceId={consoleApp.openServiceId}
      daemonOperation={consoleApp.daemonOperation}
      onProvisioningDone={consoleApp.handleProvisioningDone}
      onInstallFinished={consoleApp.handleInstallFinished}
      onRestartDone={consoleApp.handleRestartDone}
      onPurgeDone={consoleApp.handlePurgeDone}
      onOpenService={consoleApp.handleOpenService}
      onCloseService={consoleApp.handleCloseService}
      onDaemonAction={consoleApp.handleDaemonAction}
      onDeveloperDaemonAction={consoleApp.handleDaemonAction}
      onDaemonRestart={consoleApp.handleDaemonRestart}
      onSelectedServiceIndexChange={consoleApp.setSelectedServiceIndex}
    />
  );
}

const server = await createServer({
  configFile,
  appType: "custom",
  server: {
    middlewareMode: true,
    hmr: false,
    watch: {
      ignored: ["**/node_modules/**", "**/.git/**"],
    },
  },
});

const initialModule = await loadAppModule(server);

const { waitUntilExit } = render(
  <HotReloadApp server={server} initialModule={initialModule} />,
  {
    alternateScreen: true,
    exitOnCtrlC: true,
    patchConsole: true,
  },
);

try {
  await waitUntilExit();
} finally {
  await server.close();
}
