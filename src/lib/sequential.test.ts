import { expect, test } from "vitest";
import { firstSequential, forEachSequential, mapSequential } from "./sequential.ts";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("forEachSequential runs steps one at a time, in order", async () => {
  const log: string[] = [];
  await forEachSequential(["a", "b", "c"], async (item) => {
    log.push(`start ${item}`);
    await tick(item === "a" ? 15 : 1);
    log.push(`end ${item}`);
  });
  expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
});

test("forEachSequential stops at the first rejection and starts nothing after it", async () => {
  const started: number[] = [];
  await expect(
    forEachSequential([1, 2, 3], (n) => {
      started.push(n);
      if (n === 2) return Promise.reject(new Error("boom"));
    }),
  ).rejects.toThrow("boom");
  expect(started).toEqual([1, 2]);
});

test("mapSequential keeps input order and passes the index", async () => {
  const out = await mapSequential(["x", "y"], async (item, index) => {
    await tick(index === 0 ? 10 : 0);
    return `${index}:${item}`;
  });
  expect(out).toEqual(["0:x", "1:y"]);
  expect(await mapSequential([], () => 1)).toEqual([]);
});

test("firstSequential returns the first defined result and stops trying", async () => {
  const tried: number[] = [];
  const found = await firstSequential([1, 2, 3, 4], async (n) => {
    tried.push(n);
    return n === 2 ? "two" : undefined;
  });
  expect(found).toBe("two");
  expect(tried).toEqual([1, 2]);
  expect(await firstSequential([1, 2], () => undefined)).toBeUndefined();
  expect(await firstSequential([], () => "never")).toBeUndefined();
  expect(await firstSequential([1, 2], (n) => (n === 1 ? undefined : "later"))).toBe("later");
  const skipNull = (n: number) => (n === 1 ? null : "later");
  expect(await firstSequential([1, 2], skipNull as (n: number) => string | undefined)).toBe(
    "later",
  );
});
