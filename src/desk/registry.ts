import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { ensureGalleyHome, registryFile } from './home.js'

/** One Review the Desk has been shown, remembered by the id it is reachable by. */
export interface RegisteredReview {
  id: string
  root: string
  openedAt: string
}

interface RegistryFile {
  reviews?: Record<string, { root?: unknown; openedAt?: unknown }>
}

/**
 * Which folder each Review id means.
 *
 * A Review id is a hash (`docs/adr/0009`), so it cannot be read backwards: once
 * a Review is closed for idleness the Desk has no way to work out what folder
 * `/r/out-a1b2` was about. This file is that memory, and it is the whole reason
 * a bookmark still works after the Desk has restarted.
 *
 * It is a registry, never a liveness record. What is running is asked of the
 * running Desk (`GET /api/desk`), which cannot be wrong; this file only says
 * what a name meant, which stays true whether anything is running or not.
 */
export async function readRegistry(): Promise<RegisteredReview[]> {
  let parsed: RegistryFile
  try {
    parsed = JSON.parse(await readFile(registryFile(), 'utf8')) as RegistryFile
  } catch {
    // Absent, unreadable or corrupt all mean the same thing here: nothing is
    // remembered. The registry is a convenience, so it never fails a request.
    return []
  }

  const entries = Object.entries(parsed.reviews ?? {}).flatMap(([id, entry]) => {
    if (typeof entry?.root !== 'string') return []
    const openedAt = typeof entry.openedAt === 'string' ? entry.openedAt : new Date(0).toISOString()
    return [{ id, root: entry.root, openedAt }]
  })

  // A folder that has been moved or deleted is dropped rather than offered: the
  // index would otherwise fill up with Reviews that cannot be opened.
  const alive = await Promise.all(
    entries.map(async (entry) => {
      try {
        return (await stat(entry.root)).isDirectory() ? entry : undefined
      } catch {
        return undefined
      }
    }),
  )

  return alive.filter((entry): entry is RegisteredReview => entry !== undefined)
}

/** Remember that this id means this folder. */
export async function remember(id: string, root: string): Promise<void> {
  const existing = await readRegistry()
  const reviews = Object.fromEntries(
    existing.map((entry) => [entry.id, { root: entry.root, openedAt: entry.openedAt }]),
  )
  reviews[id] = { root, openedAt: new Date().toISOString() }

  await ensureGalleyHome()
  // Written beside and renamed, so a Desk stopped mid-write leaves the previous
  // registry intact rather than a truncated file.
  const destination = registryFile()
  const temporary = `${destination}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify({ reviews }, null, 2)}\n`, 'utf8')
  await rename(temporary, destination)
}

/** The folder an id was last known to mean, if any. */
export async function recall(id: string): Promise<string | undefined> {
  return (await readRegistry()).find((entry) => entry.id === id)?.root
}
