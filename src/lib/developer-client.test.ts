import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildLocalConsoleAuthHeader,
  buildLocalConsoleCanonicalPayload,
  hashLocalConsoleContent,
} from "./developer-client.ts";

const SECRET = "Aa1Bb2Cc3Dd4Ee5Ff6Gg7Hh8Ii9Jj0Kk1Ll2_Mm3Nn4Oo5Pp6";

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
