import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import path from 'node:path'

/** How much of the path hash goes into a Review id. */
const HASH_LENGTH = 4

/** Keeps a long folder name from swallowing the whole URL. */
const SLUG_LENGTH = 32

/** Where every Review lives on the Desk. */
export const REVIEW_PREFIX = '/r'

function slugOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_LENGTH)
    .replace(/-+$/, '')

  // A folder named `...` or `攻略` has nothing left after slugging. The hash
  // still tells it apart from every other Review, so only the reading suffers.
  return slug === '' ? 'review' : slug
}

/**
 * Resolve a folder to the canonical path its Review id is derived from.
 *
 * Symlinks are followed first, so `./out` and the path it points at are one
 * Review rather than two views of the same folder fighting over one sidecar.
 * A folder that has since been deleted falls back to the resolved path, which
 * keeps id derivation total — the caller decides whether a missing folder is
 * an error.
 */
export async function canonicalRoot(folder: string): Promise<string> {
  const resolved = path.resolve(folder)
  try {
    return await realpath(resolved)
  } catch {
    return resolved
  }
}

/**
 * The id a Review is reachable by — its folder's name, plus a short hash of the
 * whole path.
 *
 * This is *derived*, never assigned (`docs/adr/0009`): the same folder gives the
 * same id on every Desk, forever, which is what makes the URL bookmarkable. The
 * hash is what lets two folders both called `out` be told apart, so there is no
 * collision suffix and no dependence on what was open first.
 */
export function reviewId(canonical: string): string {
  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, HASH_LENGTH)
  return `${slugOf(path.basename(canonical))}-${digest}`
}

/** Where a Review's client, and everything under it, is served. */
export function reviewPath(id: string): string {
  return `${REVIEW_PREFIX}/${id}`
}
