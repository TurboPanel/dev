import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { siblingCheckout } from "./sibling-checkout.ts";

const DEV_LIB = dirname(fileURLToPath(import.meta.url));
const DEV_ROOT = join(DEV_LIB, "../..");
const TURBOPANELD = siblingCheckout("turbopaneld");

describe("dev converge email defaults (Deno)", () => {
  it("instance-dev-install passes Mailpit ports into instance-launch", () => {
    const playbook = readFileSync(
      join(DEV_ROOT, "orchestration/playbooks/instance-dev-install.yml"),
      "utf8",
    );
    expect(playbook).toContain("turbopanel_instance_runtime: deno");
    expect(playbook).toContain("mailpit_smtp_port: 1025");
    expect(playbook).toContain("- role: instance-launch");
  });

  // Reads the daemon's unit template; CI checks turbopaneld out beside this
  // repo and requires it (TURBOPANEL_REQUIRE_SIBLINGS), so this never skips there.
  it.skipIf(TURBOPANELD === null)(
    "turbopanel-instance unit injects mailpit-smtp for co-located Deno dev",
    () => {
    const unit = readFileSync(
      join(
        TURBOPANELD!,
        "orchestration/roles/instance-launch/templates/turbopanel-instance.service.j2",
      ),
      "utf8",
    );
    expect(unit).toContain("TURBOPANEL_SYSTEM_EMAIL__PROVIDER=mailpit-smtp");
    expect(unit).toContain(
      "TURBOPANEL_SYSTEM_EMAIL__MAILPIT_SMTP_PORT={{ mailpit_smtp_port",
    );
    expect(unit).not.toContain("TURBOPANEL_SYSTEM_EMAIL__SMTP_HOST");
    },
  );
});
