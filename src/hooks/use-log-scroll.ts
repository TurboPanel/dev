import { useCallback, useEffect, useRef, useState } from "react";
import type { Key } from "ink";
import { followLogScrollIndex } from "../lib/log-lines-equal.ts";

export function lastLogScrollIndex(lineCount: number): number {
  return Math.max(0, lineCount - 1);
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

  useEffect(() => {
    setFollowTail(true);
    setScrollIndex(lastLogScrollIndex(lineCount));
  }, [resetKey, followResetKey, lineCount]);

  useEffect(() => {
    if (focused && !wasFocusedRef.current) {
      setFollowTail(true);
      setScrollIndex(lastLogScrollIndex(lineCount));
    }
    wasFocusedRef.current = focused;
  }, [focused, lineCount]);

  useEffect(() => {
    if (followTail) {
      setScrollIndex((index) => followLogScrollIndex(index, lineCount));
    }
  }, [lineCount, followTail]);

  const pageStep = Math.max(1, viewportHeight - 1);

  const handleLogKey = useCallback(
    (key: Key) => {
      const lastIndex = lastLogScrollIndex(lineCount);

      if (key.upArrow) {
        setFollowTail(false);
        setScrollIndex((index) => Math.max(0, index - 1));
        return;
      }

      if (key.pageUp) {
        setFollowTail(false);
        setScrollIndex((index) => Math.max(0, index - pageStep));
        return;
      }

      if (key.downArrow) {
        setScrollIndex((index) => {
          const next = Math.min(lastIndex, index + 1);
          if (next >= lastIndex) {
            setFollowTail(true);
          }
          return next;
        });
        return;
      }

      if (key.pageDown) {
        setScrollIndex((index) => {
          const next = Math.min(lastIndex, index + pageStep);
          if (next >= lastIndex) {
            setFollowTail(true);
          }
          return next;
        });
        return;
      }

      if (key.end) {
        setFollowTail(true);
        setScrollIndex(lastIndex);
        return;
      }

      if (key.home) {
        setFollowTail(false);
        setScrollIndex(0);
      }
    },
    [lineCount, pageStep],
  );

  return { scrollIndex, handleLogKey };
}
