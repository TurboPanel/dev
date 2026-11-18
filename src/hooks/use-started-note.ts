import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

/** How long a "Started ..." note stays when no job line ever takes over. */
export const STARTED_NOTE_TTL_MS = 60_000

/**
 * A short note shown after a development host job was started. It clears as
 * soon as a job line exists (the line takes over the row) and after
 * STARTED_NOTE_TTL_MS at the latest, so it never comes back for a finished job.
 */
export function useStartedNote(
  jobActive: boolean
): [string | null, Dispatch<SetStateAction<string | null>>] {
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (note === null) {
      return
    }
    if (jobActive) {
      setNote(null)
      return
    }
    const id = setTimeout(() => setNote(null), STARTED_NOTE_TTL_MS)
    return () => clearTimeout(id)
  }, [note, jobActive])

  return [note, setNote]
}
