import { spawnSyncTrustedText } from "./spawn-trusted.ts";

export type DevIdentity = {
  user: string;
  uid: number;
  gid: number;
};

export class DevIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevIdentityError";
  }
}

let cachedDevIdentity: DevIdentity | null = null;

function parsePasswdLine(
  line: string,
): { user: string; uid: number; gid: number } | null {
  const parts = line.trim().split(":");
  if (parts.length < 4) {
    return null;
  }
  const user = parts[0];
  const uid = Number.parseInt(parts[2]!, 10);
  const gid = Number.parseInt(parts[3]!, 10);
  if (!user || Number.isNaN(uid) || Number.isNaN(gid)) {
    return null;
  }
  return { user, uid, gid };
}

function getentPasswd(
  query: string,
): { user: string; uid: number; gid: number } | null {
  const result = spawnSyncTrustedText("getent", ["passwd", query], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || !result.stdout) {
    return null;
  }
  return parsePasswdLine(result.stdout);
}

/** Resolve developer identity from process UID + passwd; rejects root unless SUDO_USER validates. */
export function resolveDevIdentity(): DevIdentity {
  if (cachedDevIdentity) {
    return cachedDevIdentity;
  }

  const effectiveUid = process.getuid?.() ?? -1;
  if (effectiveUid < 0) {
    throw new DevIdentityError("Cannot determine process UID");
  }

  let identity: DevIdentity;

  if (effectiveUid === 0) {
    const sudoUser = process.env.SUDO_USER?.trim();
    if (!sudoUser || sudoUser === "root") {
      throw new DevIdentityError(
        "Running as root without a valid SUDO_USER; invoke the console as your developer account",
      );
    }
    const entry = getentPasswd(sudoUser);
    if (!entry || entry.user === "root") {
      throw new DevIdentityError(
        `SUDO_USER ${sudoUser} does not resolve to a valid non-root passwd entry`,
      );
    }
    identity = { user: entry.user, uid: entry.uid, gid: entry.gid };
  } else {
    const entry = getentPasswd(String(effectiveUid));
    if (!entry || entry.user === "root") {
      throw new DevIdentityError(
        `UID ${effectiveUid} does not resolve to a valid non-root passwd entry`,
      );
    }
    const effectiveGid = process.getgid?.() ?? entry.gid;
    if (effectiveGid < 0) {
      throw new DevIdentityError("Cannot determine process GID");
    }
    identity = { user: entry.user, uid: effectiveUid, gid: effectiveGid };
  }

  cachedDevIdentity = identity;
  return identity;
}

export function tryResolveDevIdentity(): DevIdentity | null {
  try {
    return resolveDevIdentity();
  } catch {
    return null;
  }
}
