import { ensureWorkersDevVars } from "@turbopanel/lib/workers-dev-vars.ts";

const path = await ensureWorkersDevVars();
console.log(`wrote ${path}`);
