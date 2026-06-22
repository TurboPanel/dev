import React, { useEffect, useState } from "react";
import { render } from "ink";
import { BootScreen } from "./components/boot-screen.tsx";
import { openConsoleStdin } from "./lib/console-stdin.ts";

function Root() {
  const [App, setApp] = useState<React.ComponentType | null>(null);
  const [message, setMessage] = useState("Loading console modules…");

  useEffect(() => {
    const slowTimer = setTimeout(() => {
      setMessage("Still loading — compiling TypeScript modules…");
    }, 2_000);
    const slowerTimer = setTimeout(() => {
      setMessage("Still loading — first launch may take a moment…");
    }, 8_000);

    void import("./console-app.tsx")
      .then((mod) => setApp(() => mod.ConsoleApp))
      .catch((error) => {
        setMessage(
          error instanceof Error ? error.message : "Failed to load console",
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

  if (!App) {
    return <BootScreen message={message} />;
  }

  const ConsoleApp = App;
  return <ConsoleApp />;
}

const stdin = openConsoleStdin();

const { waitUntilExit } = render(<Root />, {
  stdin,
  alternateScreen: true,
  exitOnCtrlC: true,
  patchConsole: true,
});

await waitUntilExit();
