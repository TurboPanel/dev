#!/usr/bin/env node
/**
 * Update TURBOPANEL_INSTANCE_RUNTIME in dev/.env for Tilt runtime switching.
 *
 * Usage: node scripts/signal-runtime-switch.mjs <workers|deno>
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VALID = new Set(['workers', 'deno'])
const argv = process.argv.slice(2)

if (argv.length !== 1 || !VALID.has(argv[0])) {
  console.error('Usage: node scripts/signal-runtime-switch.mjs <workers|deno>')
  process.exit(1)
}

const mode = argv[0]
const envFile = join(import.meta.dirname, '..', '.env')

let envContent = ''
try {
  envContent = readFileSync(envFile, 'utf8')
} catch (err) {
  if (err.code !== 'ENOENT') throw err
}

const key = 'TURBOPANEL_INSTANCE_RUNTIME='
let found = false
const lines = envContent.split('\n').map((line) => {
  if (line.trim().startsWith('TURBOPANEL_INSTANCE_RUNTIME=')) {
    found = true
    return `${key}${mode}`
  }
  return line
})

if (!found) {
  lines.unshift(`${key}${mode}`)
}

writeFileSync(envFile, lines.join('\n'), 'utf8')
console.log(`Requested switch to ${mode} runtime (restart instance + caddy to apply)`)
