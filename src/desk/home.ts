import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/**
 * Where the Desk keeps what has to outlive it: the registry of Reviews it has
 * been shown, and its log. Overridable so the tests get their own, and so a
 * machine with an unusual home directory can move it.
 */
export function galleyHome(): string {
  return process.env.GALLEY_HOME ?? path.join(homedir(), '.galley')
}

export function registryFile(): string {
  return path.join(galleyHome(), 'reviews.json')
}

export function deskLogFile(): string {
  return path.join(galleyHome(), 'desk.log')
}

export async function ensureGalleyHome(): Promise<string> {
  const home = galleyHome()
  await mkdir(home, { recursive: true })
  return home
}
