import React from "react";
import { Text } from "ink";
import { serviceBrowserUrl } from "../lib/service-urls.ts";
import { formatTerminalHyperlink } from "../lib/terminal-hyperlink.ts";

export function ServiceBrowserLink({ serviceId }: { serviceId: string }) {
  const url = serviceBrowserUrl(serviceId);
  if (!url) {
    return null;
  }

  return (
    <Text dimColor underline>
      {formatTerminalHyperlink(url, url)}
    </Text>
  );
}
