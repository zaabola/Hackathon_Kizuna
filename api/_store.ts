// Small JSON files in nouba/data/ (git-ignored: it holds the families' phone numbers).
// shortcut: files on the GDA laptop that runs the app; a Vercel deployment needs a KV store instead (its disk is not kept).
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'data')

export function load<T>(name: string, fallback: T): T {
  try { return JSON.parse(readFileSync(join(DIR, name), 'utf8')) } catch { return fallback }
}

// Write to a temporary file, then rename: a crash mid-write never leaves a half-written file.
export function save(name: string, value: unknown) {
  mkdirSync(DIR, { recursive: true })
  const tmp = join(DIR, `${name}.tmp`)
  writeFileSync(tmp, JSON.stringify(value, null, 1))
  // OneDrive and antivirus can hold the target for a moment (EPERM on Windows): then write it in place.
  try { renameSync(tmp, join(DIR, name)) } catch { writeFileSync(join(DIR, name), JSON.stringify(value, null, 1)); rmSync(tmp, { force: true }) }
}
