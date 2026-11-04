import { useSyncExternalStore } from 'react'
import type { DevHostStatus } from '../lib/dev-host-status.ts'
import { type DevHostStatusStore, devHostStatusStore } from '../lib/dev-host-store.ts'

/** The daemon's development host status, or null when the file is missing. */
export function useDevHostStatus(
  store: DevHostStatusStore = devHostStatusStore
): DevHostStatus | null {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
