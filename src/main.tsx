import { render } from "@deno-ink/core";
import { App } from "./app.tsx";

const { waitUntilExit } = await render(<App />);
await waitUntilExit();
