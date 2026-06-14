import { render } from "@deno-ink/core";
import { App } from "./app.tsx";

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

const stdin = openStdin();
const ownsStdin = stdin !== Deno.stdin;

const { waitUntilExit } = await render(<App />, {
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
