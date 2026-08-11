import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLocalConsoleAuthHeader,
  buildLocalConsoleCanonicalPayload,
  hashLocalConsoleContent,
  instanceSecretReadError,
  parseInstanceKeyringCurrentSecret,
  readInstanceSecret,
} from "./developer-client.ts";
import { instanceSecretPath, instanceSecretsPath } from "./paths.ts";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
  };
});

const SECRET = "Aa1Bb2Cc3Dd4Ee5Ff6Gg7Hh8Ii9Jj0Kk1Ll2_Mm3Nn4Oo5Pp6";
const LEGACY_SECRET = "legacySingularSecretValue_not_for_signing_after_rotate";
const CURRENT_SECRET = "currentKeyringSecretValue_should_be_used";

const mockedReadFileSync = vi.mocked(readFileSync);

function fsError(code: string): NodeJS.ErrnoException {
  const err = new Error(code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

function mockFsMap(entries: ReadonlyMap<string, string | NodeJS.ErrnoException>): void {
  mockedReadFileSync.mockImplementation((path, ..._args) => {
    const key = String(path);
    const entry = entries.get(key);
    if (entry === undefined) {
      throw fsError("ENOENT");
    }
    if (typeof entry !== "string") {
      throw entry;
    }
    return entry;
  });
}

describe("Local-Console canonical payload (dev console)", () => {
  it("includes method, request target with query, and content digest", () => {
    const body = '{"x":1}';
    const digest = hashLocalConsoleContent(body);
    const timestamp = "2026-08-05T18:00:00.000Z";
    const payload = buildLocalConsoleCanonicalPayload(
      timestamp,
      "post",
      "/api/developer/v1/daemon/sync-dev?force=1",
      digest,
    );
    expect(payload.split("\0")).toEqual([
      "local-console-v1",
      timestamp,
      "POST",
      "/api/developer/v1/daemon/sync-dev?force=1",
      digest,
    ]);
  });

  it("buildLocalConsoleAuthHeader signs the canonical payload", () => {
    const body = "{}";
    const timestamp = "2026-08-05T18:00:00.000Z";
    const target = "/api/developer/v1/daemon/sync-dev";
    const { authorization, contentSha256 } = buildLocalConsoleAuthHeader(
      "POST",
      target,
      SECRET,
      body,
      timestamp,
    );
    expect(contentSha256).toBe(hashLocalConsoleContent(body));
    const expectedPayload = buildLocalConsoleCanonicalPayload(
      timestamp,
      "POST",
      target,
      contentSha256,
    );
    const expectedSig = createHmac("sha256", SECRET)
      .update(expectedPayload)
      .digest("base64url");
    const timestampPart = Buffer.from(timestamp, "utf8").toString("base64url");
    expect(authorization).toBe(`Local-Console ${timestampPart}.${expectedSig}`);
  });
});

describe("parseInstanceKeyringCurrentSecret", () => {
  it("returns the first entry value on a multi-entry line", () => {
    const value = parseInstanceKeyringCurrentSecret(
      "2:currentSecretValue,1:legacySecretValue",
    );
    if (value === undefined) {
      throw new TypeError("expected current secret from multi-entry keyring");
    }
    expect(value).toBe("currentSecretValue");
  });

  it("trims surrounding whitespace and newlines", () => {
    const value = parseInstanceKeyringCurrentSecret(
      "\n  2:trimmedSecret  \n",
    );
    if (value === undefined) {
      throw new TypeError("expected current secret after trim");
    }
    expect(value).toBe("trimmedSecret");
  });

  it("accepts gapped version numbers", () => {
    const value = parseInstanceKeyringCurrentSecret(
      "3:newestFirst,1:oldestStillListed",
    );
    if (value === undefined) {
      throw new TypeError("expected current secret from gapped versions");
    }
    expect(value).toBe("newestFirst");
  });

  it("returns undefined for missing colon, non-numeric version, empty value, or empty file", () => {
    expect(parseInstanceKeyringCurrentSecret("noseparator")).toBeUndefined();
    expect(parseInstanceKeyringCurrentSecret("v2:value")).toBeUndefined();
    expect(parseInstanceKeyringCurrentSecret("2:")).toBeUndefined();
    expect(parseInstanceKeyringCurrentSecret("")).toBeUndefined();
    expect(parseInstanceKeyringCurrentSecret("   \n")).toBeUndefined();
  });
});

describe("readInstanceSecret / instanceSecretReadError", () => {
  beforeEach(() => {
    mockedReadFileSync.mockReset();
  });

  it("returns the keyring current secret when the keyring is readable", () => {
    mockFsMap(
      new Map([
        [instanceSecretsPath(), `2:${CURRENT_SECRET},1:${LEGACY_SECRET}`],
        [instanceSecretPath(), LEGACY_SECRET],
      ]),
    );
    expect(readInstanceSecret()).toBe(CURRENT_SECRET);
  });

  it("falls back to the singular secret only when the keyring is absent (ENOENT)", () => {
    mockFsMap(new Map([[instanceSecretPath(), LEGACY_SECRET]]));
    expect(readInstanceSecret()).toBe(LEGACY_SECRET);
  });

  it("does not use the legacy singular secret when the keyring is present but malformed", () => {
    mockFsMap(
      new Map([
        [instanceSecretsPath(), "not-a-valid-keyring"],
        [instanceSecretPath(), LEGACY_SECRET],
      ]),
    );
    expect(readInstanceSecret()).toBeUndefined();
    const err = instanceSecretReadError();
    expect(err.message).toContain("unreadable or unparseable instance secrets keyring");
    expect(err.message).toContain(instanceSecretsPath());
    // Singular-path diagnostics phrase (distinct from the plural keyring path).
    expect(err.message).not.toMatch(/missing instance secret at/);
  });

  it("does not use the legacy singular secret when the keyring is unreadable (EACCES)", () => {
    mockFsMap(
      new Map([
        [instanceSecretsPath(), fsError("EACCES")],
        [instanceSecretPath(), LEGACY_SECRET],
      ]),
    );
    expect(readInstanceSecret()).toBeUndefined();
    const err = instanceSecretReadError();
    expect(err.message).toContain("cannot read instance secrets keyring");
    expect(err.message).toContain("permission denied");
    expect(err.message).toContain(instanceSecretsPath());
    expect(err.message).not.toMatch(/cannot read instance secret at/);
  });

  it("does not fall back on non-ENOENT keyring errors other than EACCES", () => {
    mockFsMap(
      new Map([
        [instanceSecretsPath(), fsError("EIO")],
        [instanceSecretPath(), LEGACY_SECRET],
      ]),
    );
    expect(readInstanceSecret()).toBeUndefined();
    const err = instanceSecretReadError();
    expect(err.message).toContain("unreadable or unparseable instance secrets keyring");
    expect(err.message).toContain(instanceSecretsPath());
  });
});
