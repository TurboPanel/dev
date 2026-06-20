import React from "react";
import { Box, Text } from "ink";
import { ScrollList } from "ink-scroll-list";

function truncateText(text: string, maxWidth: number): string {
  if (maxWidth < 4) {
    return "…";
  }
  if (text.length <= maxWidth) {
    return text;
  }
  return `${text.slice(0, maxWidth - 1)}…`;
}

export function PlainLogView({
  lines,
  width,
  height,
  selectedIndex,
  focused,
}: {
  lines: string[];
  width: number;
  height: number;
  selectedIndex: number;
  focused: boolean;
}) {
  const scrollIndex = lines.length === 0
    ? 0
    : Math.min(selectedIndex, lines.length - 1);

  return (
    <Box
      width={width}
      height={height}
      flexDirection="column"
      flexGrow={1}
      minHeight={0}
    >
      <ScrollList height={height} selectedIndex={scrollIndex}>
        {lines.map((line, index) => (
          <Text
            key={`${index}:${line.slice(0, 24)}`}
            dimColor={index !== scrollIndex}
            bold={focused && index === scrollIndex}
            wrap="truncate"
          >
            {truncateText(line, width)}
          </Text>
        ))}
      </ScrollList>
    </Box>
  );
}
