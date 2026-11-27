import { expect, test, vi } from 'vitest'
import { rebuildStaticUi, UI_EXPORT_FORCE_ARGS } from './static-ui-export.ts'

test('rebuildStaticUi runs ui-export --force through the orchestration path', async () => {
  const run = vi.fn(async () => {})
  const lines: string[] = []
  await rebuildStaticUi((line) => lines.push(line), run)
  expect(UI_EXPORT_FORCE_ARGS).toEqual(['ui-export', '--force'])
  expect(run).toHaveBeenCalledTimes(1)
  const call = run.mock.calls[0] as unknown as unknown[]
  expect(call[0]).toEqual(['ui-export', '--force'])
  expect(call[2]).toBeTypeOf('function')
  expect(lines).toHaveLength(2)
})

test('rebuildStaticUi surfaces a failed export', async () => {
  const run = vi.fn(async () => {
    throw new Error('export failed')
  })
  await expect(rebuildStaticUi(undefined, run)).rejects.toThrow('export failed')
})
