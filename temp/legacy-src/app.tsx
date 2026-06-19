import { App as ConsoleApp } from "./console.tsx";
import { App as ProductionApp } from "./app-production.tsx";

const consoleUi = Deno.env.get("TURBOPANEL_CONSOLE_UI")?.trim().toLowerCase();

/** Default: console.tsx. Set TURBOPANEL_CONSOLE_UI=production for shipped UI. */
export const App = consoleUi === "production" ? ProductionApp : ConsoleApp;
