import { instanceRepoPath } from "./paths.ts";
import { type InstallOutputHandler, runCaptured } from "./install-output.ts";
import { shellQuote } from "./shell-quote.ts";

const INSTANCE_UNIT = "turbopanel-instance";

/**
 * Wipe the dev Postgres schema and re-apply migrations, then restart the
 * instance so it returns to a fresh install wizard.
 *
 * All database access reuses the instance checkout's own ops tooling
 * (`scripts/db-connect.sh` resolves the DB URL from the `turbopanel-instance`
 * systemd unit and locates node + drizzle-kit). Nothing about this lives in the
 * instance application — the console owns and drives the action. Runs directly
 * as the invoking dev user: the instance checkout under `$HOME` is dev-owned and
 * Postgres/`TURBOPANEL_DATABASE_URL` access does not require the turbopanel
 * identity.
 */
const WIPE_AND_MIGRATE_SCRIPT = `set -euo pipefail
ROOT=${shellQuote(instanceRepoPath())}
cd "$ROOT"
# shellcheck source=/dev/null
source "$ROOT/scripts/db-connect.sh"
db_connect_init reset-dev-db
db_connect_build_database_url reset-dev-db
export TURBOPANEL_DATABASE_URL
echo "reset-dev-db: wiping public schema"
"$NODE" --input-type=module <<'NODE_EOF'
import postgres from 'postgres'
import { resolvePostgresParts } from './scripts/resolve-postgres-url.mjs'

const url = process.env.TURBOPANEL_DATABASE_URL
const parts = resolvePostgresParts(url)
if (!parts) {
  console.error('reset-dev-db: invalid TURBOPANEL_DATABASE_URL')
  process.exit(1)
}
// Mirror the instance's own resolvePostgresConnection() shape exactly
// (socket → { host, database, user, pass }; tcp → url string).
const sql = parts.socketDir
  ? postgres({
    host: parts.socketDir,
    database: parts.database,
    user: parts.user,
    pass: parts.pass,
  })
  : postgres(parts.tcpUrl ?? url, { prepare: false })
try {
  await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE')
  await sql.unsafe('CREATE SCHEMA public')
  await sql.unsafe('GRANT ALL ON SCHEMA public TO PUBLIC')
} finally {
  await sql.end({ timeout: 5 })
}
NODE_EOF
echo "reset-dev-db: applying migrations"
"$NODE" "$DRIZZLE_KIT" migrate --config drizzle.config.mjs
echo "reset-dev-db: migrations applied"
`;

export async function resetDevDatabase(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  const lines: string[] = [];
  const append = (line: string) => {
    lines.push(line);
    onOutput?.(line);
  };

  const resetCode = await runCaptured(
    ["bash", "-c", WIPE_AND_MIGRATE_SCRIPT],
    append,
  );
  if (resetCode !== 0) {
    throw new Error(lines.at(-1) ?? "Failed to reset dev database");
  }

  append("reset-dev-db: restarting turbopanel-instance");
  const restartCode = await runCaptured(
    ["sudo", "-n", "systemctl", "restart", INSTANCE_UNIT],
    append,
  );
  if (restartCode !== 0) {
    throw new Error(lines.at(-1) ?? "Failed to restart turbopanel-instance");
  }
}
