import type { DaemonLogLine } from "./daemon-log.ts";
import type { ServiceLogLine } from "./service-log.ts";

export function serviceLogLinesEqual(
  current: ServiceLogLine[],
  next: ServiceLogLine[],
): boolean {
  if (current.length !== next.length) {
    return false;
  }

  return current.every((line, index) => {
    const other = next[index]!;
    return line.text === other.text && line.time === other.time;
  });
}

export function daemonLogLinesEqual(
  current: DaemonLogLine[],
  next: DaemonLogLine[],
): boolean {
  if (current.length !== next.length) {
    return false;
  }

  return current.every((line, index) => {
    const other = next[index]!;
    return (
      line.time === other.time &&
      line.level === other.level &&
      line.component === other.component &&
      line.message === other.message &&
      line.err === other.err
    );
  });
}

export function serviceLogLineKey(line: ServiceLogLine, index: number): string {
  return `${line.time ?? index}:${line.text}`;
}

export function daemonLogLineKey(line: DaemonLogLine, index: number): string {
  return `${line.time}:${line.component}:${line.message}:${line.err ?? ""}:${index}`;
}

/** Keep tail-follow pinned unless the user scrolled up into history. */
export function followLogScrollIndex(
  currentIndex: number,
  lineCount: number,
): number {
  const lastIndex = Math.max(0, lineCount - 1);
  if (lineCount === 0) {
    return 0;
  }
  if (currentIndex >= lastIndex - 1) {
    return lastIndex;
  }
  return Math.min(currentIndex, lastIndex);
}
