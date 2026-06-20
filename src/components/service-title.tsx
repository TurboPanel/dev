import React from "react";
import { Box, Text } from "ink";
import figlet from "figlet";
import Gradient, { type GradientName } from "ink-gradient";

const TITLE_GRADIENT: GradientName = "atlas";
const TITLE_FONTS = ["Calvin S", "Small"] as const;
const MIN_TITLE_WIDTH = 12;

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

export function measureTitleArtRows(label: string, width: number): number {
  const maxWidth = Math.max(1, width - 2);
  if (maxWidth < MIN_TITLE_WIDTH) {
    return 1;
  }

  const art = renderTitleArt(label, maxWidth);
  return art ? art.split("\n").length : 1;
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

function GradientLabel({ text }: { text: string }) {
  return (
    <Gradient name={TITLE_GRADIENT}>
      <Text bold>{text}</Text>
    </Gradient>
  );
}

function GradientArt({ art }: { art: string }) {
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
}: {
  serviceId: string;
  label: string;
  width: number;
}) {
  const maxWidth = Math.max(1, width - 2);

  if (maxWidth < MIN_TITLE_WIDTH) {
    return <GradientLabel text={label} />;
  }

  const art = renderTitleArt(label, maxWidth);
  if (!art) {
    return <GradientLabel text={label} />;
  }

  return (
    <Box flexDirection="column" width={maxWidth} marginTop={1}>
      <GradientArt art={art} />
    </Box>
  );
}
