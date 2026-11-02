import { afterEach, describe, expect, it, vi } from 'vitest'

describe('resolveDevIdentity with a contributor-chosen user name', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('resolves a user that is not named vagrant', async () => {
    vi.resetModules()
    vi.doMock('./spawn-trusted.ts', () => ({
      spawnSyncTrustedText: vi.fn(() => ({
        status: 0,
        stdout: 'pat:x:1001:1001::/home/pat:/bin/bash\n',
        stderr: '',
        pid: 1,
        output: ['', 'pat:x:1001:1001::/home/pat:/bin/bash\n', ''],
        signal: null,
      })),
    }))
    vi.spyOn(process, 'getuid').mockReturnValue(1001)
    vi.spyOn(process, 'getgid').mockReturnValue(1001)
    const { resolveDevIdentity } = await import('./dev-identity.ts')
    expect(resolveDevIdentity()).toEqual({ user: 'pat', uid: 1001, gid: 1001 })
  })
})
