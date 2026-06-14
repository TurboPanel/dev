import { runInherit } from "@turbopanel/platform-install";

const DEV_HOST_ACCESS_SCRIPT = "scripts/lib/dev-host-access.sh";

export async function ensureDevHostAccess(): Promise<void> {
  const script = `${Deno.cwd()}/${DEV_HOST_ACCESS_SCRIPT}`;
  const code = await runInherit(["sh", script]);
  if (code !== 0) {
    throw new Error("dev host access setup failed");
  }
}
