import type { Io, Row } from "./lib.mjs";

export const CANARY_RAIL: number;
export const HOSTED: readonly { id: string; label: string; url: string; branch: string }[];
export function runPreflight(io: Io, options?: { hosted?: boolean }): Promise<Row[]>;
