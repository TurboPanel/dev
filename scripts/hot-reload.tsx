import { fileURLToPath } from "node:url";
import React, { useEffect, useState } from "react";
import { render, useInput, useWindowSize } from "ink";
import { createServer, normalizePath, type ViteDevServer } from "vite";
import type { AppView as AppViewComponent, AREAS as AppAreas } from "../src/app.tsx";

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
  const [activeIndex, setActiveIndex] = useState(0);
  const [appModule, setAppModule] = useState(initialModule);

  useInput((_input, key) => {
    const areas = appModule.AREAS;
    if (key.leftArrow) {
      setActiveIndex((index) => Math.max(0, index - 1));
    }
    if (key.rightArrow) {
      setActiveIndex((index) => Math.min(areas.length - 1, index + 1));
    }
  });

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
          // Keep the current UI mounted while the user fixes a syntax/runtime error.
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
  return <AppView activeIndex={activeIndex} columns={columns} rows={rows} />;
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
  },
);

try {
  await waitUntilExit();
} finally {
  await server.close();
}
