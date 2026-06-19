import React from "react";
import { Box, Text } from "ink";
import figlet from "figlet";
import Gradient, { type GradientName } from "ink-gradient";
import BigText, { type BigTextProps } from "ink-big-text";

type AsciiTitleConfig = {
  kind: "ascii";
  text: string;
  font: string;
  gradient: GradientName;
};

type BigTextTitleConfig = {
  kind: "bigText";
  text: string;
  font: NonNullable<BigTextProps["font"]>;
  gradient: GradientName;
};

type ServiceTitleConfig = AsciiTitleConfig | BigTextTitleConfig;

const SERVICE_TITLES: Record<string, ServiceTitleConfig> = {
  daemon: {
    kind: "ascii",
    text: "Daemon",
    font: "Slant Relief",
    gradient: "vice",
  },
  instance: {
    kind: "bigText",
    text: "instance",
    font: "simple",
    gradient: "morning",
  },
  ui: {
    kind: "bigText",
    text: "UI",
    font: "block",
    gradient: "instagram",
  },
  website: {
    kind: "ascii",
    text: "Website",
    font: "Small Slant",
    gradient: "summer",
  },
};

const ASCII_FALLBACK_FONT = "Small Slant";
const MIN_TITLE_WIDTH = 18;

function asciiArt(text: string, font: string, maxWidth: number): string | null {
  const tryFont = (fontName: string): string | null => {
    try {
      const art = figlet.textSync(text, {
        font: fontName,
        horizontalLayout: "fitted",
      });
      const lineWidth = Math.max(...art.split("\n").map((line) => line.length), 0);
      if (lineWidth > maxWidth) {
        return null;
      }
      return art;
    } catch {
      return null;
    }
  };

  return tryFont(font) ?? (font !== ASCII_FALLBACK_FONT ? tryFont(ASCII_FALLBACK_FONT) : null);
}

function AsciiTitle({
  config,
  maxWidth,
}: {
  config: AsciiTitleConfig;
  maxWidth: number;
}) {
  const art = asciiArt(config.text, config.font, maxWidth);
  if (!art) {
    return <Text bold>{config.text}</Text>;
  }

  return (
    <Gradient name={config.gradient}>
      <Text>{art}</Text>
    </Gradient>
  );
}

function BigTextTitle({
  config,
  maxWidth,
}: {
  config: BigTextTitleConfig;
  maxWidth: number;
}) {
  if (maxWidth < MIN_TITLE_WIDTH) {
    return <Text bold>{config.text}</Text>;
  }

  return (
    <Gradient name={config.gradient}>
      <BigText
        text={config.text}
        font={config.font}
        maxLength={maxWidth}
      />
    </Gradient>
  );
}

export function ServiceTitle({
  serviceId,
  label,
  width,
}: {
  serviceId: string;
  label: string;
  width: number;
}) {
  const maxWidth = Math.max(1, width - 2);
  const config = SERVICE_TITLES[serviceId];

  if (!config) {
    return <Text bold>{label}</Text>;
  }

  return (
    <Box flexDirection="column" width={maxWidth}>
      {config.kind === "ascii" ? (
        <AsciiTitle config={config} maxWidth={maxWidth} />
      ) : (
        <BigTextTitle config={config} maxWidth={maxWidth} />
      )}
    </Box>
  );
}
