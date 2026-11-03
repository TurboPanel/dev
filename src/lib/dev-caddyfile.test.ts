import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CADDYFILE = fileURLToPath(new URL('../../orchestration/Caddyfile', import.meta.url))

function readCaddyfile(): string {
  return readFileSync(CADDYFILE, 'utf8')
}

describe('development Caddyfile', () => {
  it('keeps the routing in the turbopanel_app snippet the named sites import', () => {
    const caddyfile = readCaddyfile()
    const snippet = caddyfile.indexOf('(turbopanel_app) {')
    expect(snippet).toBeGreaterThanOrEqual(0)
    const site = caddyfile.indexOf(':{$CADDY_PORT:8443} {')
    expect(site).toBeGreaterThan(snippet)
    const siteBlock = caddyfile.slice(site, caddyfile.indexOf('\n}\n', site))
    expect(siteBlock).toContain('import turbopanel_app')
    expect(siteBlock).toMatch(/tls \{\$CADDY_TLS_CERT:[^}]+\} \{\$CADDY_TLS_KEY:[^}]+\}/)
  })

  it('imports the daemon-rendered hostname sites from the dev sites directory', () => {
    const caddyfile = readCaddyfile()
    const site = caddyfile.indexOf(':{$CADDY_PORT:8443} {')
    const sitesImport = caddyfile.indexOf(
      'import {$TURBOPANEL_DEV_SITES_DIR:/etc/turbopanel/caddy/dev-sites}/*.caddy'
    )
    expect(sitesImport).toBeGreaterThan(site)
  })

  it('matches every instance prefix ahead of the UI catch-all', () => {
    const caddyfile = readCaddyfile()
    const catchAll = caddyfile.lastIndexOf('try_files {path} /index.html')
    for (const prefix of ['/api/*', '/ws/*', '/webhook/*']) {
      const matcher = caddyfile.indexOf(`path ${prefix}`)
      expect(matcher, `${prefix} is matched`).toBeGreaterThanOrEqual(0)
      expect(matcher, `${prefix} precedes the catch-all`).toBeLessThan(catchAll)
    }
  })
})
