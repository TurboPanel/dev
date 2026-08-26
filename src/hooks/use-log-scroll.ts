import { useCallback, useEffect, useRef, useState } from "react";
import type { Key } from "ink";
import { followLogScrollIndex } from "../lib/log-lines-equal.ts";

export function lastLogScrollIndex(lineCount: number): number {
  return Math.max(0, lineCount - 1);
}

export type LogScrollState = {
  scrollIndex: number;
  followTail: boolean;
};

/** Pure scroll-key reducer shared by {@link useLogScroll} for unit tests. */
export function applyLogScrollKey(
  state: LogScrollState,
  key: Key,
  lineCount: number,
  pageStep: number,
): LogScrollState | null {
  const lastIndex = lastLogScrollIndex(lineCount);

  if (key.upArrow) {
    return {
      followTail: false,
      scrollIndex: Math.max(0, state.scrollIndex - 1),
    };
  }

  if (key.pageUp) {
    return {
      followTail: false,
      scrollIndex: Math.max(0, state.scrollIndex - pageStep),
    };
  }

  if (key.downArrow) {
    const next = Math.min(lastIndex, state.scrollIndex + 1);
    return {
      scrollIndex: next,
      followTail: next >= lastIndex ? true : state.followTail,
    };
  }

  if (key.pageDown) {
    const next = Math.min(lastIndex, state.scrollIndex + pageStep);
    return {
      scrollIndex: next,
      followTail: next >= lastIndex ? true : state.followTail,
    };
  }

  if (key.end) {
    return { followTail: true, scrollIndex: lastIndex };
  }

  if (key.home) {
    return { followTail: false, scrollIndex: 0 };
  }

  return null;
}

export function useLogScroll({
  lineCount,
  viewportHeight,
  focused,
  resetKey,
  followResetKey,
}: {
  lineCount: number;
  viewportHeight: number;
  focused: boolean;
  resetKey?: string | number;
  /** Bumped after service restarts to re-pin the viewport to the log tail. */
  followResetKey?: number;
}) {
  const [scrollIndex, setScrollIndex] = useState(0);
  const [followTail, setFollowTail] = useState(true);
  const wasFocusedRef = useRef(false);
  const pendingTailPinRef = useRef(false);

  useEffect(() => {
    setFollowTail(true);
    pendingTailPinRef.current = true;
    setScrollIndex(lastLogScrollIndex(lineCount));
  }, [resetKey, followResetKey]);

  useEffect(() => {
    if (focused && !wasFocusedRef.current) {
      setFollowTail(true);
      setScrollIndex(lastLogScrollIndex(lineCount));
    }
    wasFocusedRef.current = focused;
  }, [focused, lineCount]);

  useEffect(() => {
    if (pendingTailPinRef.current) {
      setScrollIndex(lastLogScrollIndex(lineCount));
      pendingTailPinRef.current = false;
      return;
    }
    if (followTail) {
      setScrollIndex((index) => followLogScrollIndex(index, lineCount));
    }
  }, [lineCount, followTail]);

  const pageStep = Math.max(1, viewportHeight - 1);

  const handleLogKey = useCallback(
    (key: Key) => {
      const next = applyLogScrollKey(
        { scrollIndex, followTail },
        key,
        lineCount,
        pageStep,
      );
      if (next === null) {
        return;
      }
      setFollowTail(next.followTail);
      setScrollIndex(next.scrollIndex);
    },
    [followTail, lineCount, pageStep, scrollIndex],
  );

  return { scrollIndex, handleLogKey };
}
