import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { DRAFT_EXTENSIONS, type DraftExtension, type DraftSummary } from '../shared/types.js'

/** A Draft as the filesystem knows it, before its Notes are counted in. */
export type DraftFile = Omit<DraftSummary, 'openNoteCount'>

/** Directories never worth walking into when looking for Drafts. */
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', '.feedback'])

function draftExtensionOf(filename: string): DraftExtension | undefined {
  const extension = path.extname(filename).toLowerCase()
  return (DRAFT_EXTENSIONS as readonly string[]).includes(extension)
    ? (extension as DraftExtension)
    : undefined
}

/**
 * Every Draft in the Review, at any depth, with paths relative to the Review
 * root. The listing is flat and sorted; the sidebar builds the tree from it.
 */
export async function listDrafts(reviewRoot: string): Promise<DraftFile[]> {
  const drafts: DraftFile[] = []

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(entry.name)) continue

      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!entry.isFile()) continue

      const extension = draftExtensionOf(entry.name)
      if (!extension) continue

      drafts.push({
        path: path.relative(reviewRoot, absolute).split(path.sep).join('/'),
        name: entry.name,
        extension,
      })
    }
  }

  await walk(reviewRoot)
  return drafts.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Resolve a Review-relative Draft path to an absolute one, refusing anything
 * that escapes the Review root or isn't a reviewable format.
 */
export function resolveDraftPath(reviewRoot: string, draftPath: string): string | undefined {
  if (!draftPath || path.isAbsolute(draftPath)) return undefined
  if (!draftExtensionOf(draftPath)) return undefined

  const absolute = path.resolve(reviewRoot, draftPath)
  const relative = path.relative(reviewRoot, absolute)
  const escapesRoot = relative.startsWith('..') || path.isAbsolute(relative)
  return escapesRoot ? undefined : absolute
}

/** A Draft's contents, or undefined if it isn't a readable file in the Review. */
export async function readDraft(
  reviewRoot: string,
  draftPath: string,
): Promise<{ extension: DraftExtension; content: string } | undefined> {
  const absolute = resolveDraftPath(reviewRoot, draftPath)
  if (!absolute) return undefined

  try {
    const stats = await stat(absolute)
    if (!stats.isFile()) return undefined
  } catch {
    return undefined
  }

  return {
    extension: draftExtensionOf(draftPath)!,
    content: await readFile(absolute, 'utf8'),
  }
}
