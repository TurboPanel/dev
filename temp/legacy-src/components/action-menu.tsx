import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export type ActionMenuItem = {
  label: string;
  value: string;
};

export function ActionMenu({
  items,
  onSelect,
}: {
  items: ActionMenuItem[];
  onSelect: (item: ActionMenuItem) => void;
}) {
  const [index, setIndex] = useState(0);

  useInput((_, key) => {
    if (key.upArrow) {
      setIndex((current) => Math.max(0, current - 1));
    } else if (key.downArrow) {
      setIndex((current) => Math.min(items.length - 1, current + 1));
    } else if (key.return) {
      onSelect(items[index]);
    }
  });

  return (
    <Box flexDirection="column">
      {items.map((item, itemIndex) => (
        <Text
          key={item.value}
          color={itemIndex === index ? "cyan" : undefined}
          bold={itemIndex === index}
          wrap="truncate"
        >
          {itemIndex === index ? "› " : "  "}{item.label}
        </Text>
      ))}
    </Box>
  );
}
