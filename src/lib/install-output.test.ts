import { expect, test } from "vitest";
import { captureChildEnv } from "./install-output.ts";
import { TRUSTED_SYSTEM_PATH } from "./spawn-trusted.ts";

test("captureChildEnv defaults PATH to trusted FHS dirs", () => {
  const env = captureChildEnv({ FOO: "bar" });
  expect(env.FOO).toBe("bar");
  expect(env.PATH).toBe(TRUSTED_SYSTEM_PATH);
  expect(env.CI).toBe("1");
});

test("captureChildEnv keeps an explicit caller PATH (vendored Node/Deno)", () => {
  const path = "/opt/turbopanel/vendor/node/current/bin:/usr/bin:/bin";
  const env = captureChildEnv({ PATH: path, FOO: "bar" });
  expect(env.PATH).toBe(path);
  expect(env.FOO).toBe("bar");
});

test("captureChildEnv treats a blank PATH as missing", () => {
  const env = captureChildEnv({ PATH: "" });
  expect(env.PATH).toBe(TRUSTED_SYSTEM_PATH);
});
