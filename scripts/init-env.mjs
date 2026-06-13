#!/usr/bin/env node
/**
 * Dev-only: create dev/.env from .env.example and fill missing managed variables
 * (secrets, ports, Postgres defaults). Called from the Tiltfile and sync-env.sh.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSecret } from '../../instance/scripts/generate-secret.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const devRoot = join(scriptDir, '..')
const envPath = join(devRoot, '.env')
const examplePath = join(devRoot, '.env.example')

const ENV_LINE_RE = /^([A-Za-z_]\w*)=(.*)$/

const ENV_KEY_DOCS = {
  TURBOPANEL_SECRET:
    'Root signing secret (48 chars, auto-generated when unset). HKDF derives session keys from UTF-8 bytes.',
  TURBOPANEL_INSTANCE_RUNTIME: 'workers (wrangler) or deno (self-hosted socket path).',
  INSTANCE_DEV_PORT: 'Wrangler dev TCP port (internal; Caddy proxies :8443).',
  TURBOPANEL_IS_SIGNUP_ENABLED: '1 enables public sign-up in local Workers dev.',
  POSTGRES_USER: 'Local Tilt Postgres user.',
  POSTGRES_PASSWORD: 'Local Tilt Postgres password.',
  POSTGRES_DB: 'Local Tilt Postgres database name.',
  POSTGRES_HOST: 'Local Tilt Postgres host.',
  POSTGRES_PORT: 'Local Tilt Postgres port.',
  CADDY_PORT: 'HTTPS entrypoint (Caddy).',
  TURBOPANEL_UI_MODE: 'dev proxies to Expo; static serves exported UI.',
  EXPO_PORT: 'Expo web dev server port.',
  WEBSITE_PORT: 'Next.js marketing/docs dev server port.',
  MAILPIT_SMTP_PORT: 'Mailpit SMTP port.',
  MAILPIT_WEB_PORT: 'Mailpit web UI port.',
  TURBOPANEL_TLS_EXTRA_SANS: 'Optional comma-separated DNS names for the dev TLS cert.',
}

const MANAGED_DEFAULTS = {
  TURBOPANEL_INSTANCE_RUNTIME: 'workers',
  INSTANCE_DEV_PORT: '18787',
  TURBOPANEL_IS_SIGNUP_ENABLED: '1',
  POSTGRES_USER: 'turbopanel',
  POSTGRES_PASSWORD: 'turbopanel-dev',
  POSTGRES_DB: 'turbopanel',
  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: '5432',
  CADDY_PORT: '8443',
  TURBOPANEL_UI_MODE: 'dev',
  EXPO_PORT: '8081',
  WEBSITE_PORT: '19820',
  MAILPIT_SMTP_PORT: '19825',
  MAILPIT_WEB_PORT: '19826',
  TURBOPANEL_TLS_EXTRA_SANS: '',
}

const MANAGED_KEYS_ORDERED = [
  'TURBOPANEL_INSTANCE_RUNTIME',
  'TURBOPANEL_SECRET',
  'INSTANCE_DEV_PORT',
  'TURBOPANEL_IS_SIGNUP_ENABLED',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'CADDY_PORT',
  'TURBOPANEL_UI_MODE',
  'EXPO_PORT',
  'WEBSITE_PORT',
  'MAILPIT_SMTP_PORT',
  'MAILPIT_WEB_PORT',
  'TURBOPANEL_TLS_EXTRA_SANS',
]

function needsValue(key, vars) {
  if (!(key in vars)) return true
  const value = vars[key]
  if (value === undefined) return true
  if (value.trim().startsWith('CHANGE_ME')) return true
  return false
}

function parseEnvFile(filePath) {
  const lines = []
  const vars = {}
  try {
    for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
      lines.push(line)
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = ENV_LINE_RE.exec(trimmed)
      if (match) {
        const [, key, raw] = match
        vars[key] = raw.trim()
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  return { lines, vars }
}

function ensureEnvExists() {
  if (!existsSync(envPath)) {
    if (!existsSync(examplePath)) {
      console.error('init-env: .env.example not found — cannot create .env')
      process.exit(1)
    }
    copyFileSync(examplePath, envPath)
    console.log('init-env: created .env from .env.example')
  }
}

function buildUpdates(vars) {
  const updates = {}

  for (const [key, value] of Object.entries(MANAGED_DEFAULTS)) {
    if (needsValue(key, vars)) {
      updates[key] = value
    }
  }

  if (needsValue('TURBOPANEL_SECRET', vars) && needsValue('TURBOPANEL_SECRETS', vars)) {
    updates.TURBOPANEL_SECRET = generateSecret()
  }

  return updates
}

function upsertManagedKeys(filePath, updates) {
  if (Object.keys(updates).length === 0) return []

  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const written = new Set()

  const nextLines = lines.map((line) => {
    const trimmed = line.trim()
    const match = ENV_LINE_RE.exec(trimmed)
    if (!match) return line
    const key = match[1]
    if (updates[key] === undefined) return line
    written.add(key)
    return `${key}=${updates[key]}`
  })

  const toAppend = []
  for (const key of MANAGED_KEYS_ORDERED) {
    if (updates[key] === undefined || written.has(key)) continue
    const doc = ENV_KEY_DOCS[key]
    if (doc) {
      toAppend.push(`# ${doc}`)
    }
    toAppend.push(`${key}=${updates[key]}`)
    toAppend.push('')
    written.add(key)
  }

  if (toAppend.length > 0) {
    while (nextLines.length > 0 && nextLines.at(-1) === '') {
      nextLines.pop()
    }
    nextLines.push('', ...toAppend)
  }

  const normalized = nextLines.join('\n').replace(/\n*$/, '\n')
  writeFileSync(filePath, normalized, 'utf-8')
  return [...written]
}

function logUpdates(updates) {
  if (updates.TURBOPANEL_SECRET) {
    console.log('init-env: generated TURBOPANEL_SECRET')
  }
  for (const key of MANAGED_KEYS_ORDERED) {
    if (key === 'TURBOPANEL_SECRET') continue
    if (updates[key] !== undefined) {
      console.log(`init-env: set ${key}=${updates[key]}`)
    }
  }
}

function main() {
  ensureEnvExists()
  const { vars } = parseEnvFile(envPath)
  const updates = buildUpdates(vars)
  const written = upsertManagedKeys(envPath, updates)
  if (written.length > 0) {
    logUpdates(updates)
  }
}

main()
