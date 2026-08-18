import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const TASKS = readFileSync(
  join(REPO_ROOT, "orchestration/roles/dev-shell-path/tasks/main.yml"),
  "utf8",
);

describe("dev-shell-path role", () => {
  test("always installs a bash/login profile.d snippet", () => {
    expect(TASKS).toContain("/etc/profile.d/turbopanel-dev-deno.sh");
  });

  test("gates zsh drop-ins on /usr/bin/zsh existing", () => {
    expect(TASKS).toContain("path: /usr/bin/zsh");
    expect(TASKS).toContain("_dev_zsh.stat.exists");
    expect(TASKS).toContain("path: /etc/zsh/zshenv");
    expect(TASKS).toContain("not _dev_zsh.stat.exists");
  });

  test("PATH drop-ins are dest-group readable without world bits", () => {
    expect(TASKS).toContain('group: "{{ turbopanel_group }}"');
    expect(TASKS).toContain('mode: "0640"');
    expect(TASKS).toContain('mode: "0750"');
    expect(TASKS).not.toContain('mode: "0644"');
    expect(TASKS).not.toContain('mode: "0755"');
  });
});
