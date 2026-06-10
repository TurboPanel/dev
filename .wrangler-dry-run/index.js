// src/workers/index.ts
import script from "./a3b9f404f4d299448a117005e76124168f5e4507-idempotent.sh";
var SCRIPT_PATHS = /* @__PURE__ */ new Set(["/", "/develop", "/develop/idempotent.sh"]);
var index_default = {
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (!SCRIPT_PATHS.has(pathname)) {
      return new Response("Not Found", { status: 404 });
    }
    return new Response(script, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache"
      }
    });
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
