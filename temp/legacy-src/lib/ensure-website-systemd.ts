import { runInherit } from "@turbopanel/lib/platform-install.ts";

const WEBSITE_UNIT = "/etc/systemd/system/turbopanel-website.service";
const REPAIR_SCRIPT = "scripts/repair-website-systemd.sh";

export function websiteSystemdUnitPresent(): boolean {
  try {
    const stat = Deno.statSync(WEBSITE_UNIT);
    return stat.isFile;
  } catch {
    return false;
  }
}

/** Install turbopanel-website.service when Ansible has not yet converged the unit. */
export async function ensureWebsiteSystemdUnit(): Promise<void> {
  if (websiteSystemdUnitPresent()) return;

  console.log("→ Installing turbopanel-website.service (Next.js on :19820)...");
  const script = `${Deno.cwd()}/${REPAIR_SCRIPT}`;
  const code = await runInherit(["sh", script]);
  if (code !== 0) {
    throw new Error(
      "failed to install turbopanel-website.service — run: sudo sh scripts/repair-website-systemd.sh",
    );
  }
}
