import type { Io } from "./lib.mjs";

export function makeIo(token: string, doFetch?: typeof fetch): Io;
export function main(argv: readonly string[], out?: (line: string) => void): Promise<number>;
