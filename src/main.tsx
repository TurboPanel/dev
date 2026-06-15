import { render } from "@deno-ink/core";
import React, { useEffect, useState } from "react";
import { BootScreen } from "./boot-screen.tsx";

function openStdin(): Deno.FsFile | typeof Deno.stdin {
  if (Deno.stdin.isTerminal()) {
    return Deno.stdin;
  }

  try {
    return Deno.openSync("/dev/tty", { read: true, write: false });
  } catch {
    return Deno.stdin;
  }
}

function Root() {
  const [app, setApp] = useState<React.ComponentType | null>(null);
  const [message, setMessage] = useState("Loading console modules…");

  useEffect(() => {
    const slowTimer = setTimeout(() => {
      setMessage("Still loading — compiling TypeScript modules…");
    }, 2_000);
    const slowerTimer = setTimeout(() => {
      setMessage("Still loading — fetching dependencies from JSR/npm…");
    }, 8_000);

    void import("./app.tsx")
      .then((mod) => setApp(() => mod.App))
      .catch((err) => {
        setMessage(
          err instanceof Error ? err.message : "Failed to load console",
        );
      })
      .finally(() => {
        clearTimeout(slowTimer);
        clearTimeout(slowerTimer);
      });

    return () => {
      clearTimeout(slowTimer);
      clearTimeout(slowerTimer);
    };
  }, []);

  if (!app) {
    return <BootScreen message={message} />;
  }

  const App = app;
  return <App />;
}

const stdin = openStdin();
const ownsStdin = stdin !== Deno.stdin;

const { waitUntilExit } = await render(<Root />, {
  stdin,
  fullScreen: true,
  exitOnCtrlC: true,
});

try {
  await waitUntilExit();
} finally {
  if (ownsStdin) {
    try {
      stdin.close();
    } catch {
      // ignore
    }
  }
}
