import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8')

describe('guest memory setup scripts', () => {
  const bootstrap = read('scripts/vm-bootstrap.sh')

  test('--swap adds zstd zram at half of RAM, above the swap file', () => {
    expect(bootstrap).toContain('echo zstd >/sys/block/zram0/comp_algorithm')
    expect(bootstrap).toContain('size=$((mem_kib * 1024 / 2))')
    expect(bootstrap).toContain('swapon -p 100 /dev/zram0')
    expect(bootstrap).toContain('/swapfile')
  })

  test('swap settings are written to a sysctl drop-in and the unit is enabled', () => {
    expect(bootstrap).toContain('vm.swappiness = 150')
    expect(bootstrap).toContain('vm.page-cluster = 0')
    expect(bootstrap).toContain('systemctl enable turbopanel-zram-swap.service')
  })

  test('the zram helper is idempotent', () => {
    expect(bootstrap).toContain("grep -q '^/dev/zram0[[:space:]]' /proc/swaps")
  })

  test('the Lima guest setup catches an existing guest up once', () => {
    const lima = read('scripts/lima-guest-setup.sh')
    expect(lima).toContain('[ ! -x /usr/local/sbin/tp-zram-swap ]')
    expect(lima).toContain('vm-bootstrap.sh" --swap')
  })

  test('the Incus guest setup only keeps the Expo unit off outside Expo mode', () => {
    const incus = read('scripts/incus-guest-setup.sh')
    expect(incus).toContain('[ "$UI_MODE" != dev ]')
    expect(incus).toContain('systemctl disable turbopanel-ui.service')
    expect(incus).not.toContain('turbopanel-website turbopanel-dbstudio')
    expect(incus).not.toContain('systemctl disable "$unit.service"')
    // The Metro heap drop-in stays.
    expect(incus).toContain('--max-old-space-size=3072')
  })
})

describe('instance-dev-install playbook UI mode', () => {
  const playbook = read('orchestration/playbooks/instance-dev-install.yml')

  test('the Expo option defaults off', () => {
    expect(playbook).toContain('turbopanel_optional_ui: false')
  })

  test('the Expo unit is enabled only in dev mode with the option on', () => {
    expect(playbook).toContain(
      "enabled: \"{{ ((turbopanel_ui_mode | default('dev')) == 'dev') and (turbopanel_optional_ui | default(false) | bool) }}\""
    )
  })
})
