import {
  PLATFORM_REPOS,
  platformRepoPath,
  sshRepoUrl,
  TURBOPANEL_PLATFORM,
} from "@turbopanel/paths";

const BRANCH = "trunk";

async function commandExists(name: string): Promise<boolean> {
  const proc = new Deno.Command("command", {
    args: ["-v", name],
    stdout: "null",
    stderr: "null",
  });
  return (await proc.output()).success;
}

async function runInherit(cmd: string[]): Promise<number> {
  const proc = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return (await proc.output()).code ?? 1;
}

function canWritePlatformDir(): boolean {
  try {
    Deno.mkdirSync(TURBOPANEL_PLATFORM, { recursive: true });
    Deno.accessSync(TURBOPANEL_PLATFORM, { write: true });
    return true;
  } catch {
    return false;
  }
}

async function ensurePlatformDir(): Promise<void> {
  if (canWritePlatformDir()) {
    return;
  }

  const user = Deno.env.get("USER") ?? Deno.env.get("LOGNAME") ?? "root";
  console.log(`→ Administrator privileges required for ${TURBOPANEL_PLATFORM}`);

  const code = await runInherit([
    "sudo",
    "sh",
    "-c",
    `mkdir -p '${TURBOPANEL_PLATFORM}' && chown -R '${user}:' '${TURBOPANEL_PLATFORM}'`,
  ]);

  if (code !== 0) {
    throw new Error(`Failed to create ${TURBOPANEL_PLATFORM}`);
  }
}

async function ensureGit(): Promise<void> {
  if (await commandExists("git")) {
    return;
  }

  console.log("→ git not found — installing");
  const code = await runInherit([
    "sudo",
    "sh",
    "-c",
    "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y git",
  ]);

  if (code !== 0 || !(await commandExists("git"))) {
    throw new Error("Failed to install git");
  }
}

async function isGitRepo(path: string): Promise<boolean> {
  const proc = new Deno.Command("git", {
    args: ["-C", path, "rev-parse", "--git-dir"],
    stdout: "null",
    stderr: "null",
  });
  return (await proc.output()).success;
}

async function hasUncommittedChanges(path: string): Promise<boolean> {
  const proc = new Deno.Command("git", {
    args: ["-C", path, "status", "--porcelain"],
    stdout: "piped",
    stderr: "null",
  });
  const output = await proc.output();
  if (!output.success) {
    return true;
  }
  return new TextDecoder().decode(output.stdout).trim().length > 0;
}

async function ensureOriginUrl(path: string, url: string): Promise<void> {
  const proc = new Deno.Command("git", {
    args: ["-C", path, "remote", "get-url", "origin"],
    stdout: "piped",
    stderr: "null",
  });
  const output = await proc.output();
  if (!output.success) {
    return;
  }

  const current = new TextDecoder().decode(output.stdout).trim();
  if (current === url) {
    return;
  }

  await runInherit(["git", "-C", path, "remote", "set-url", "origin", url]);
}

async function cloneOrUpdateRepo(
  dir: string,
  repo: string,
): Promise<"cloned" | "updated" | "skipped"> {
  const target = platformRepoPath(dir);
  const url = sshRepoUrl(repo);

  try {
    Deno.statSync(target);
  } catch {
    console.log(`→ Cloning ${dir}...`);
    const code = await runInherit([
      "git",
      "clone",
      "--branch",
      BRANCH,
      url,
      target,
    ]);
    if (code !== 0) {
      throw new Error(`Failed to clone ${dir}`);
    }
    console.log(`✓ Cloned ${dir}`);
    return "cloned";
  }

  if (!(await isGitRepo(target))) {
    throw new Error(`${target} exists but is not a git repository`);
  }

  await ensureOriginUrl(target, url);

  if (await hasUncommittedChanges(target)) {
    console.log(`⚠ ${dir} has uncommitted changes — skipped`);
    return "skipped";
  }

  console.log(`→ Updating ${dir}...`);
  const code = await runInherit([
    "git",
    "-C",
    target,
    "pull",
    "--ff-only",
    "origin",
    BRANCH,
  ]);
  if (code !== 0) {
    throw new Error(`Failed to update ${dir}`);
  }
  console.log(`✓ Updated ${dir}`);
  return "updated";
}

export async function installPlatformRepos(): Promise<void> {
  await ensureGit();
  await ensurePlatformDir();

  for (const { dir, repo } of PLATFORM_REPOS) {
    await cloneOrUpdateRepo(dir, repo);
  }

  console.log("");
  console.log("✓ Platform repositories ready");
  console.log(`  ${TURBOPANEL_PLATFORM}/`);
  for (const { dir } of PLATFORM_REPOS) {
    console.log(`  ├── ${dir}/`);
  }
  console.log("");
  console.log("Run ./dev.sh to return to the console.");
}
