interface AssetsFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetsFetcher;
}

const DEVELOP_SCRIPT_PATH = "/develop.sh";
const ALLOWED_METHODS = "GET, HEAD";

function buildDevelopScriptHeaders(): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "text/x-shellscript; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return headers;
}

function resolveDevelopScriptPath(pathname: string): string | null {
  if (pathname === "/" || pathname === DEVELOP_SCRIPT_PATH) {
    return DEVELOP_SCRIPT_PATH;
  }
  return null;
}

function methodNotAllowed(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: ALLOWED_METHODS },
  });
}

function isAllowedMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!isAllowedMethod(request.method)) {
      return methodNotAllowed();
    }

    const url = new URL(request.url);
    const assetPath = resolveDevelopScriptPath(url.pathname);
    if (assetPath === null) {
      return new Response("Not Found", { status: 404 });
    }

    const assetRequest = new Request(new URL(assetPath, request.url), {
      method: request.method,
    });
    const assetResponse = await env.ASSETS.fetch(assetRequest);
    const body = request.method === "HEAD" ? null : assetResponse.body;

    return new Response(body, {
      status: assetResponse.status,
      headers: buildDevelopScriptHeaders(),
    });
  },
};
