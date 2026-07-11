import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import figlet from "figlet";
import Gradient, { type GradientName } from "ink-gradient";

const TITLE_GRADIENT: GradientName = "atlas";
const TITLE_FONTS = ["Calvin S", "Small"] as const;
const MIN_TITLE_WIDTH = 12;
/** Rows reserved before figlet art is ready (Calvin S is typically 3–4). */
const TITLE_ART_PLACEHOLDER_ROWS = 4;

const titleArtCache = new Map<string, string | null>();

function titleArtCacheKey(text: string, maxWidth: number): string {
  return `${maxWidth}:${text}`;
}

function trimBlankLines(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/\r$/, ""));

  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim() === "") {
    start += 1;
  }
  while (end > start && lines[end - 1].trim() === "") {
    end -= 1;
  }

  return lines.slice(start, end).join("\n");
}

function renderTitleArt(text: string, maxWidth: number): string | null {
  for (const font of TITLE_FONTS) {
    try {
      const art = trimBlankLines(
        figlet.textSync(text, {
          font,
          horizontalLayout: "fitted",
        }),
      );
      if (art.length === 0) {
        continue;
      }

      const lineWidth = Math.max(...art.split("\n").map((line) => line.length), 0);
      if (lineWidth <= maxWidth) {
        return art;
      }
    } catch {
      // try next font
    }
  }

  return null;
}

function getCachedTitleArt(text: string, maxWidth: number): string | null | undefined {
  return titleArtCache.get(titleArtCacheKey(text, maxWidth));
}

function computeAndCacheTitleArt(text: string, maxWidth: number): string | null {
  const key = titleArtCacheKey(text, maxWidth);
  const cached = titleArtCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const art = renderTitleArt(text, maxWidth);
  titleArtCache.set(key, art);
  return art;
}

export function measureTitleArtRows(label: string, width: number): number {
  const maxWidth = Math.max(1, width - 2);
  if (maxWidth < MIN_TITLE_WIDTH) {
    return 1;
  }

  const cached = getCachedTitleArt(label, maxWidth);
  if (cached === undefined) {
    return TITLE_ART_PLACEHOLDER_ROWS;
  }
  return cached ? cached.split("\n").length : 1;
}

/**
 * Warm the figlet cache in the background, one label at a time, so navigation
 * never pays sync figlet cost. Gaps between jobs let stdin keep processing.
 */
export function prewarmTitleArt(
  labels: readonly string[],
  width: number,
  gapMs = 75,
): () => void {
  const maxWidth = Math.max(1, width - 2);
  if (maxWidth < MIN_TITLE_WIDTH) {
    return () => {};
  }

  let index = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const tick = () => {
    if (cancelled) {
      return;
    }
    while (index < labels.length) {
      const label = labels[index]!;
      index += 1;
      if (getCachedTitleArt(label, maxWidth) === undefined) {
        computeAndCacheTitleArt(label, maxWidth);
        timer = setTimeout(tick, gapMs);
        return;
      }
    }
  };

  timer = setTimeout(tick, gapMs);
  return () => {
    cancelled = true;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  };
}

function GradientLabel({ text }: Readonly<{ text: string }>) {
  return (
    <Gradient name={TITLE_GRADIENT}>
      <Text bold>{text}</Text>
    </Gradient>
  );
}

function GradientArt({ art }: Readonly<{ art: string }>) {
  const lines = art.split("\n");

  return (
    <Gradient name={TITLE_GRADIENT}>
      {lines.map((line, index) => (
        <Text key={index} wrap="truncate">{line}</Text>
      ))}
    </Gradient>
  );
}

export function ServiceTitle({
  label,
  width,
  shrinkWrap = false,
  /** When false, never run figlet — cache hit or plain label only (nav hot path). */
  allowFiglet = true,
}: {
  serviceId: string;
  label: string;
  width: number;
  /** Size to figlet art width instead of filling `width` (for inline badges). */
  shrinkWrap?: boolean;
  allowFiglet?: boolean;
}) {
  const maxWidth = Math.max(1, width - 2);
  const cached = maxWidth < MIN_TITLE_WIDTH
    ? null
    : getCachedTitleArt(label, maxWidth);
  const [art, setArt] = useState<string | null | undefined>(
    maxWidth < MIN_TITLE_WIDTH ? null : cached,
  );

  if (maxWidth < MIN_TITLE_WIDTH) {
    if (art !== null) {
      setArt(null);
    }
  } else if (cached !== undefined && art !== cached) {
    setArt(cached);
  } else if (cached === undefined && art != null) {
    setArt(undefined);
  }

  useEffect(() => {
    if (!allowFiglet || maxWidth < MIN_TITLE_WIDTH) {
      return;
    }
    if (getCachedTitleArt(label, maxWidth) !== undefined) {
      return;
    }

    let cancelled = false;
    // Settle delay: if the user keeps moving, this is cleared before figlet runs.
    const id = setTimeout(() => {
      const next = computeAndCacheTitleArt(label, maxWidth);
      if (!cancelled) {
        setArt(next);
      }
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [label, maxWidth, allowFiglet]);

  if (maxWidth < MIN_TITLE_WIDTH || !art) {
    return <GradientLabel text={label} />;
  }

  return (
    <Box flexDirection="column" width={shrinkWrap ? undefined : maxWidth}>
      <GradientArt art={art} />
    </Box>
  );
}
