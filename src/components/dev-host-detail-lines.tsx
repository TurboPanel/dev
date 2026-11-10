import React from 'react'
import { Box, Text } from 'ink'
import type { DevHostDetailLine } from '../lib/dev-host-status.ts'
import { STATUS_PENDING } from '../theme.ts'

/**
 * The development host lines above a Services row's detail, in the web
 * interface bar's words: what the part needs, the daemon's reason when it
 * will not pull, and on the control plane row the database line (muted, as
 * it is information rather than something to do). Each line is one row, cut
 * to the width.
 */
export function DevHostDetailLines({
  lines,
  width,
}: Readonly<{ lines: readonly DevHostDetailLine[]; width: number }>) {
  if (lines.length === 0) return null
  return (
    <Box width={width} flexDirection="column" paddingX={1} flexShrink={0}>
      {lines.map((line) => (
        <Text
          key={line.text}
          color={line.database ? undefined : STATUS_PENDING}
          dimColor={line.database}
          wrap="truncate"
        >
          {line.text}
        </Text>
      ))}
    </Box>
  )
}
