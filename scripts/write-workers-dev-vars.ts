import { ensureWorkersDevVars } from "@turbopanel/workers-dev-vars";

const path = await ensureWorkersDevVars();
console.log(`wrote ${path}`);
