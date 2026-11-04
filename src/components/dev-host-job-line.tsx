import React from 'react'
import { Box, Text } from 'ink'
import { useDevHostStatus } from '../hooks/use-dev-host-status.ts'
import { devHostStatusJobLine, type DevHostJobLine as JobLine } from '../lib/dev-host-status.ts'
import { LOG_ERROR, STATUS_INSTALLING } from '../theme.ts'

/** The current job line, for callers that size their panes around it. */
export function useDevHostJobLine(): JobLine | null {
  const status = useDevHostStatus()
  return devHostStatusJobLine(status, Date.now())
}

/**
 * One line about a development host job: its step while it runs, or why it
 * failed shortly after. Read from the daemon's status file, so it keeps
 * moving while the control plane restarts.
 */
export function DevHostJobLine({
  line,
  width,
  inset = true,
}: Readonly<{ line: JobLine | null; width: number; inset?: boolean }>) {
  if (!line) return null
  return (
    <Box width={width} height={1} paddingX={inset ? 1 : 0} flexShrink={0}>
      <Text color={line.failed ? LOG_ERROR : STATUS_INSTALLING} wrap="truncate">
        {line.text}
      </Text>
    </Box>
  )
}
