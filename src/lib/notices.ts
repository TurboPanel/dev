/**
 * Third-party notice generation and license-policy checks.
 *
 * Reads the *resolved* graph (pnpm license listing / lockfiles / native
 * trees), never the top-level manifest alone. Generated markdown is not a
 * relicense — third-party components keep their own copyright and terms.
 */

export const NOTICES_FILE_NAME = 'THIRD_PARTY_NOTICES.md'

export type NoticeRole =
  | 'production'
  | 'development'
  | 'orchestration'
  | 'native'

export type NoticePackage = Readonly<{
  name: string
  version: string
  license: string
  role: NoticeRole
  homepage?: string
  copyright?: string
  noticeText?: string
  source?: string
}>

export type LicensePolicyReason =
  | 'missing'
  | 'custom'
  | 'see-license-in'
  | 'noncommercial'
  | 'source-available'
  | 'copyleft-production'
  | 'mpl-production'

export type LicensePolicyFailure = Readonly<{
  name: string
  version: string
  license: string
  role: NoticeRole
  reason: LicensePolicyReason
}>

/** Repository license used when classifying first-party / same-license AGPL. */
export type LicensePolicyContext = Readonly<{
  repoLicense?: string
}>

/**
 * Default policy host license for this copy of the notices module.
 * Website (Apache-2.0) must not silently allow third-party AGPL production deps.
 */
export const NOTICE_POLICY_REPO_LICENSE = 'AGPL-3.0-only'

export type NoticesRenderOptions = Readonly<{
  repoLicense: string
  productName: string
  regenerateCommand: string
  lockfileFingerprints: Readonly<Record<string, string>>
  complementNoticePath?: string
  extraPreamble?: string
}>

export type PnpmLicenseEntry = Readonly<{
  name?: string
  versions?: readonly string[]
  paths?: readonly string[]
  license?: string
  author?: string | Readonly<{ name?: string }>
  homepage?: string
  description?: string
}>

const KNOWN_PERMISSIVE = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-2-Clause-Patent',
  'BSD-3-Clause',
  'BSD-3-Clause-Clear',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT-0',
  'OFL-1.1',
  'Python-2.0',
  'Unlicense',
])

const PROJECT_AGPL = 'AGPL-3.0-only'
const MPL = 'MPL-2.0'
const ORCH_GPL = 'GPL-3.0-or-later'

/** MPL-2.0 production deps reviewed for build-time / dynamically-linked native use. */
const REVIEWED_MPL_PRODUCTION = /^lightningcss(?:-|$)/

/** Optional native image bindings (Next/sharp) — dynamically linked, reviewed. */
const REVIEWED_LGPL_PRODUCTION = /^@img\/sharp(?:-|$)/

/** Registry rows with no `license` field — reviewed defaults (not a relicense). */
const KNOWN_PACKAGE_LICENSES: Record<string, string> = {
  khroma: 'MIT',
}

export function defaultLicenseForPackageName(name: string): string | undefined {
  const base = name.includes('/') ? (name.split('/').pop() ?? name) : name
  if (KNOWN_PACKAGE_LICENSES[base]) return KNOWN_PACKAGE_LICENSES[base]
  if (name.startsWith('@std/')) return 'MIT'
  if (name.startsWith('@tamagui/')) return 'MIT'
  return undefined
}

export function noticePackageKey(pkg: Pick<NoticePackage, 'name' | 'version'>): string {
  return `${pkg.name}@${pkg.version}`
}

export function authorToCopyright(author: PnpmLicenseEntry['author']): string | undefined {
  if (typeof author === 'string') {
    const trimmed = author.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  const name = author?.name?.trim()
  return name && name.length > 0 ? name : undefined
}

/**
 * Flatten `pnpm licenses list --json` (optionally `--long`) into one row per
 * name@version. `prodKeys` marks shipped packages; everything else is
 * development-only.
 */
export function packagesFromPnpmLicenses(
  grouped: Readonly<Record<string, readonly PnpmLicenseEntry[]>>,
  prodKeys: ReadonlySet<string>,
): NoticePackage[] {
  const byKey = new Map<string, NoticePackage>()
  for (const [groupLicense, entries] of Object.entries(grouped)) {
    for (const entry of entries) {
      for (const pkg of entryToNoticePackages(entry, groupLicense, prodKeys)) {
        byKey.set(noticePackageKey(pkg), pkg)
      }
    }
  }
  return [...byKey.values()]
}

/** One row per version of a single `pnpm licenses list` entry. */
function entryToNoticePackages(
  entry: PnpmLicenseEntry,
  groupLicense: string,
  prodKeys: ReadonlySet<string>,
): NoticePackage[] {
  const name = entry.name?.trim()
  if (!name) return []
  const license = (entry.license ?? groupLicense).trim() || groupLicense
  const homepage = entry.homepage?.trim() || undefined
  const copyright = authorToCopyright(entry.author)
  const out: NoticePackage[] = []
  for (const version of entry.versions ?? []) {
    const ver = version.trim()
    if (!ver) continue
    out.push({
      name,
      version: ver,
      license,
      role: prodKeys.has(`${name}@${ver}`) ? 'production' : 'development',
      homepage,
      copyright,
    })
  }
  return out
}

export function pnpmLicenseKeys(
  grouped: Readonly<Record<string, readonly PnpmLicenseEntry[]>>,
): Set<string> {
  const keys = new Set<string>()
  for (const pkg of packagesFromPnpmLicenses(grouped, keys)) {
    keys.add(noticePackageKey(pkg))
  }
  return keys
}

type NpmLockPackage = Readonly<{
  version?: string
  license?: string
  dev?: boolean
  name?: string
}>

type NpmLockfile = Readonly<{
  packages?: Readonly<Record<string, NpmLockPackage>>
}>

/** Resolved npm lockfile v2/v3 graph (`package-lock.json`). */
export function packagesFromNpmLockfile(lock: NpmLockfile): NoticePackage[] {
  const packages = lock.packages ?? {}
  const out: NoticePackage[] = []
  for (const [installPath, meta] of Object.entries(packages)) {
    if (installPath === '') continue
    const name = npmLockName(installPath, meta.name)
    const version = meta.version?.trim()
    if (!name || !version) continue
    out.push({
      name,
      version,
      license: typeof meta.license === 'string' ? meta.license.trim() : '',
      role: meta.dev === true ? 'development' : 'production',
      source: 'package-lock.json',
    })
  }
  return out
}

function npmLockName(installPath: string, explicit?: string): string | undefined {
  if (explicit?.trim()) return explicit.trim()
  const marker = 'node_modules/'
  const idx = installPath.lastIndexOf(marker)
  if (idx === -1) return undefined
  const rest = installPath.slice(idx + marker.length)
  return rest.length > 0 ? rest : undefined
}

export type DenoLockfile = Readonly<{
  jsr?: Readonly<Record<string, unknown>>
  npm?: Readonly<Record<string, unknown>>
}>

/** Resolved Deno lock (`deno.lock`) — licenses filled by the caller. */
export function packagesFromDenoLock(
  lock: DenoLockfile,
  licenses: Readonly<Record<string, string>>,
): NoticePackage[] {
  const out: NoticePackage[] = []
  for (const id of Object.keys(lock.jsr ?? {})) {
    const parsed = parseDenoLockId(id)
    if (!parsed) continue
    out.push({
      ...parsed,
      license: licenses[noticePackageKey(parsed)] ?? licenses[id] ?? '',
      role: 'production',
      source: 'deno.lock (jsr)',
    })
  }
  for (const id of Object.keys(lock.npm ?? {})) {
    const parsed = parseDenoLockId(id)
    if (!parsed) continue
    out.push({
      ...parsed,
      license: licenses[noticePackageKey(parsed)] ?? licenses[id] ?? '',
      role: 'production',
      source: 'deno.lock (npm)',
    })
  }
  return out
}

// Both `jsr` and `npm` entries are keyed `<name>@<version>`, so the two
// sections parse identically.
function parseDenoLockId(id: string): { name: string; version: string } | undefined {
  const at = id.lastIndexOf('@')
  if (at <= 0) return undefined
  const name = id.slice(0, at)
  const version = id.slice(at + 1).trim()
  if (!name || !version) return undefined
  return { name, version }
}

/** CocoaPods resolved graph from `Podfile.lock`. */
export function packagesFromPodfileLock(text: string): NoticePackage[] {
  const out: NoticePackage[] = []
  const seen = new Set<string>()
  for (const line of text.split('\n')) {
    const match = /^ {2}- ([^\s(]+) \(([^)]+)\)/.exec(line)
    if (!match) continue
    const name = match[1]?.trim()
    const version = match[2]?.trim()
    if (!name || !version) continue
    const key = `${name}@${version}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      name,
      version,
      license: '',
      role: 'native',
      source: 'Podfile.lock',
    })
  }
  return out
}

export function attachLicensesFromMap(
  packages: readonly NoticePackage[],
  licenses: Readonly<Record<string, string>>,
): NoticePackage[] {
  return packages.map((pkg) => {
    const found = licenses[noticePackageKey(pkg)] ?? licenses[pkg.name]
    if (!found) return pkg
    return { ...pkg, license: found }
  })
}

export function mergeNoticePackages(
  groups: readonly (readonly NoticePackage[])[],
): NoticePackage[] {
  const byKey = new Map<string, NoticePackage>()
  const roleRank: Record<NoticeRole, number> = {
    production: 0,
    native: 1,
    orchestration: 2,
    development: 3,
  }
  for (const group of groups) {
    for (const pkg of group) {
      const key = noticePackageKey(pkg)
      const existing = byKey.get(key)
      if (!existing) {
        byKey.set(key, pkg)
        continue
      }
      if (roleRank[pkg.role] < roleRank[existing.role]) {
        byKey.set(key, {
          ...pkg,
          noticeText: pkg.noticeText ?? existing.noticeText,
          copyright: pkg.copyright ?? existing.copyright,
          homepage: pkg.homepage ?? existing.homepage,
        })
      }
    }
  }
  return [...byKey.values()]
}

export function evaluateLicensePolicy(
  packages: readonly NoticePackage[],
  context: LicensePolicyContext = {},
): LicensePolicyFailure[] {
  const failures: LicensePolicyFailure[] = []
  for (const pkg of packages) {
    const reason = classifyLicense(pkg.license, pkg.role, pkg.name, context)
    if (reason) {
      failures.push({
        name: pkg.name,
        version: pkg.version,
        license: pkg.license,
        role: pkg.role,
        reason,
      })
    }
  }
  return failures
}

export function classifyLicense(
  rawLicense: string,
  role: NoticeRole,
  packageName = '',
  context: LicensePolicyContext = {},
): LicensePolicyReason | null {
  const license = rawLicense.trim()
  if (license.length === 0 || isMissingLicense(license)) {
    return 'missing'
  }
  if (isSeeLicenseIn(license)) {
    return 'see-license-in'
  }
  if (isNoncommercial(license)) {
    return 'noncommercial'
  }
  if (isSourceAvailable(license)) {
    return 'source-available'
  }
  if (isCustomLicense(license)) {
    return 'custom'
  }
  return classifySpdxExpression(license, role, packageName, context)
}

function classifySpdxExpression(
  expr: string,
  role: NoticeRole,
  packageName = '',
  context: LicensePolicyContext = {},
): LicensePolicyReason | null {
  const orParts = splitTopLevel(expr, ' OR ')
  if (orParts && orParts.length > 1) {
    const partResults = orParts.map((part) =>
      classifySpdxExpression(part, role, packageName, context),
    )
    if (partResults.includes(null)) {
      return null
    }
    return partResults[0] ?? 'custom'
  }
  const andParts = splitTopLevel(expr, ' AND ')
  if (andParts && andParts.length > 1) {
    for (const part of andParts) {
      const result = classifySpdxExpression(part, role, packageName, context)
      if (result) return result
    }
    return null
  }
  return classifySpdxToken(stripWithException(unwrapParens(expr)), role, packageName, context)
}

function classifySpdxToken(
  token: string,
  role: NoticeRole,
  packageName = '',
  context: LicensePolicyContext = {},
): LicensePolicyReason | null {
  const repoLicense = context.repoLicense ?? NOTICE_POLICY_REPO_LICENSE
  if (token === PROJECT_AGPL && repoLicense === PROJECT_AGPL) return null
  if (KNOWN_PERMISSIVE.has(token)) return null
  if (token === MPL) return classifyMpl(role, packageName)
  if (token === ORCH_GPL) return role === 'orchestration' ? null : 'copyleft-production'
  if (isCopyleftToken(token)) return classifyCopyleft(role, packageName)
  return 'custom'
}

function classifyMpl(role: NoticeRole, packageName: string): LicensePolicyReason | null {
  if (role === 'development') return null
  return REVIEWED_MPL_PRODUCTION.test(packageName) ? null : 'mpl-production'
}

function classifyCopyleft(role: NoticeRole, packageName: string): LicensePolicyReason | null {
  if (role === 'development') return null
  return REVIEWED_LGPL_PRODUCTION.test(packageName) ? null : 'copyleft-production'
}

function isCopyleftToken(token: string): boolean {
  return (
    token.startsWith('GPL-') ||
    token.startsWith('LGPL-') ||
    token.startsWith('AGPL-') ||
    token.startsWith('EUPL-') ||
    token.startsWith('OSL-') ||
    token.startsWith('CPL-') ||
    token === 'Sleepycat' ||
    token.startsWith('CDDL-')
  )
}

function isMissingLicense(license: string): boolean {
  const upper = license.toUpperCase()
  return (
    upper === 'UNLICENSED' ||
    upper === 'UNKNOWN' ||
    upper === 'NONE' ||
    upper === 'NOASSERTION' ||
    upper === 'UNLICENSED LICENSE'
  )
}

function isSeeLicenseIn(license: string): boolean {
  return /SEE LICENSE IN/i.test(license)
}

function isNoncommercial(license: string): boolean {
  return (
    /non-?commercial/i.test(license) ||
    /CC-BY-NC/i.test(license) ||
    /commons-clause/i.test(license)
  )
}

function isSourceAvailable(license: string): boolean {
  return (
    /^BUSL-/i.test(license) ||
    /^SSPL-/i.test(license) ||
    /^FSL-/i.test(license) ||
    /Fair Source/i.test(license) ||
    /^Elastic-2/i.test(license) ||
    /PolyForm-Noncommercial/i.test(license)
  )
}

function isCustomLicense(license: string): boolean {
  return /^LicenseRef-/i.test(license) || /^SEE /i.test(license)
}

function stripWithException(token: string): string {
  const idx = token.toUpperCase().indexOf(' WITH ')
  if (idx === -1) return token.trim()
  return token.slice(0, idx).trim()
}

function unwrapParens(expr: string): string {
  let current = expr.trim()
  while (current.startsWith('(') && current.endsWith(')') && balanced(current)) {
    current = current.slice(1, -1).trim()
  }
  return current
}

function balanced(expr: string): boolean {
  let depth = 0
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i]
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (depth < 0) return false
    if (depth === 0 && i < expr.length - 1) return false
  }
  return depth === 0
}

function splitTopLevel(expr: string, delimiter: ' OR ' | ' AND '): string[] | null {
  const unwrapped = unwrapParens(expr)
  const upper = unwrapped.toUpperCase()
  const parts: string[] = []
  let depth = 0
  let start = 0
  let i = 0
  while (i < unwrapped.length) {
    const ch = unwrapped[i]
    if (ch === '(') {
      depth += 1
    } else if (ch === ')') {
      depth -= 1
    } else if (depth === 0 && upper.startsWith(delimiter, i)) {
      pushTrimmed(parts, unwrapped.slice(start, i))
      i += delimiter.length
      start = i
      continue
    }
    i += 1
  }
  pushTrimmed(parts, unwrapped.slice(start))
  return parts.length > 1 ? parts : null
}

function pushTrimmed(parts: string[], slice: string): void {
  const trimmed = slice.trim()
  if (trimmed.length > 0) parts.push(trimmed)
}

export function renderThirdPartyNotices(
  packages: readonly NoticePackage[],
  options: NoticesRenderOptions,
): string {
  const sorted = sortNoticePackages(packages)
  const lines: string[] = [
    '# Third-party notices',
    '',
    `This file is generated from the resolved dependency graph. Do not edit it by hand. Regenerate with \`${options.regenerateCommand}\`.`,
    '',
    `Third-party components remain under their own copyright and license terms and are not relicensed by ${options.productName}'s repository license (${options.repoLicense}).`,
  ]
  if (options.complementNoticePath) {
    lines.push(
      '',
      `This file complements \`${options.complementNoticePath}\` (the Apache-2.0 NOTICE for first-party material). It does not replace that file.`,
    )
  }
  if (options.extraPreamble) {
    lines.push('', options.extraPreamble)
  }
  lines.push('', '<!-- lockfiles')
  const fingerprintKeys = Object.keys(options.lockfileFingerprints).sort((a, b) =>
    a.localeCompare(b),
  )
  for (const file of fingerprintKeys) {
    lines.push(`${file} ${options.lockfileFingerprints[file]}`)
  }
  lines.push('-->', '')

  appendSection(lines, 'Production dependencies', sorted.filter((pkg) => pkg.role === 'production'))
  appendSection(
    lines,
    'Development-only dependencies',
    sorted.filter((pkg) => pkg.role === 'development'),
    'These packages are used for development, test, or build tooling and are not bundled into shipped artifacts.',
  )
  appendSection(
    lines,
    'Orchestration tooling',
    sorted.filter((pkg) => pkg.role === 'orchestration'),
    'Python / Ansible Galaxy pins installed into the host orchestration environment. GPL-3.0-or-later here is an intentional, reviewed exception — not a general production-JS allow.',
  )
  appendSection(
    lines,
    'Native dependencies',
    sorted.filter((pkg) => pkg.role === 'native'),
    'Resolved after Expo prebuild (CocoaPods / Gradle / bundled resources). Absent from checkouts that do not contain generated `ios/` or `android/` trees.',
  )

  const notices = sorted.filter((pkg) => pkg.noticeText?.trim())
  if (notices.length > 0) {
    lines.push(
      '## Upstream NOTICE files',
      '',
      'The following Apache-2.0 (or similarly NOTICE-bearing) works require preservation of this attribution.',
      '',
    )
    for (const pkg of notices) {
      lines.push(`### ${noticePackageKey(pkg)}`, '', '```', pkg.noticeText?.trim() ?? '', '```', '')
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}

function appendSection(
  lines: string[],
  title: string,
  packages: readonly NoticePackage[],
  intro?: string,
): void {
  lines.push(`## ${title}`, '')
  if (packages.length === 0) {
    lines.push('_None._', '')
    return
  }
  if (intro) {
    lines.push(intro, '')
  }
  for (const pkg of packages) {
    lines.push(`### ${noticePackageKey(pkg)}`, '', `- License: ${pkg.license || '(missing)'}`)
    if (pkg.copyright) lines.push(`- Copyright: ${pkg.copyright}`)
    if (pkg.homepage) lines.push(`- Homepage: ${pkg.homepage}`)
    if (pkg.source) lines.push(`- Source: ${pkg.source}`)
    lines.push('')
  }
}

export function sortNoticePackages(packages: readonly NoticePackage[]): NoticePackage[] {
  return [...packages].sort((a, b) => {
    const nameCmp = a.name.localeCompare(b.name)
    if (nameCmp !== 0) return nameCmp
    return a.version.localeCompare(b.version)
  })
}

export function noticesAreCurrent(existing: string, generated: string): boolean {
  return normalizeNotices(existing) === normalizeNotices(generated)
}

function normalizeNotices(text: string): string {
  return text.replaceAll('\r\n', '\n').trimEnd()
}

export function formatPolicyFailures(failures: readonly LicensePolicyFailure[]): string {
  return failures
    .map(
      (failure) =>
        `${failure.name}@${failure.version} license=${JSON.stringify(failure.license)} role=${failure.role} (${failure.reason})`,
    )
    .join('\n')
}

export function fingerprintCommentValue(hex: string): string {
  return `sha256:${hex}`
}

/** First install path per name@version from `pnpm licenses list --json --long`. */
export function pnpmPackagePaths(
  grouped: Readonly<Record<string, readonly PnpmLicenseEntry[]>>,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const entries of Object.values(grouped)) {
    for (const entry of entries) {
      const name = entry.name?.trim()
      const pkgPath = entry.paths?.[0]?.trim()
      if (!name || !pkgPath) continue
      for (const version of entry.versions ?? []) {
        const ver = version.trim()
        if (!ver) continue
        map.set(`${name}@${ver}`, pkgPath)
      }
    }
  }
  return map
}

export function attachNoticeText(
  pkg: NoticePackage,
  noticeText: string | undefined,
): NoticePackage {
  const trimmed = noticeText?.trim()
  if (!trimmed) return pkg
  return { ...pkg, noticeText: trimmed }
}

export type OrchestrationPin = Readonly<{
  name: string
  version: string
  license: string
}>

/** Declared orchestration pins (requirements.txt / Galaxy YAML), not JS lockfiles. */
export function packagesFromOrchestrationPins(
  pins: readonly OrchestrationPin[],
): NoticePackage[] {
  return pins.map((pin) => ({
    name: pin.name,
    version: pin.version,
    license: pin.license,
    role: 'orchestration',
    source: 'orchestration',
  }))
}

export async function fillMissingLicenses(
  packages: readonly NoticePackage[],
  lookup: (pkg: NoticePackage) => Promise<string>,
): Promise<NoticePackage[]> {
  const out: NoticePackage[] = []
  for (const pkg of packages) {
    if (!needsLicenseLookup(pkg.license)) {
      out.push(pkg)
      continue
    }
    const lookedUp = (await lookup(pkg)).trim()
    const license = lookedUp || defaultLicenseForPackageName(pkg.name) || ''
    out.push(license ? { ...pkg, license } : pkg)
  }
  return out
}

export function needsLicenseLookup(license: string): boolean {
  const trimmed = license.trim()
  return trimmed.length === 0 || isMissingLicense(trimmed)
}

/** Fill Unknown / empty licenses from install-tree metadata before policy checks. */
export function enrichMissingPackageLicenses(
  packages: readonly NoticePackage[],
  resolve: (pkg: NoticePackage) => string | undefined,
): NoticePackage[] {
  return packages.map((pkg) => {
    if (!needsLicenseLookup(pkg.license)) return pkg
    const resolved = resolve(pkg)?.trim() || defaultLicenseForPackageName(pkg.name)
    return resolved ? { ...pkg, license: resolved } : pkg
  })
}
