import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { DRAFT_EXTENSIONS } from '../shared/types.js'
import type { ReviewEvents } from './events.js'
import { FLAGS_FILE, NOTES_FILE, SIDECAR_DIRECTORY } from './sidecar.js'

/** Long enough to coalesce an agent's write burst, short enough to feel live. */
const SETTLE_MS = 80

/**
 * Watch the Review for changes made outside the editor — an agent rewriting a
 * Draft, or appending a Reply to the sidecar — and announce them.
 */
export function watchReview(reviewRoot: string, events: ReviewEvents): FSWatcher {
  const root = path.resolve(reviewRoot)

  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    // Only the sidecar matters inside dot-folders; everything else hidden,
    // plus node_modules, is noise the reviewer never sees.
    ignored: (candidate: string) => {
      const relative = path.relative(root, candidate)
      if (relative === '') return false

      const segments = relative.split(path.sep)
      if (segments.includes('node_modules')) return true
      return segments.some(
        (segment) => segment.startsWith('.') && segment !== SIDECAR_DIRECTORY,
      )
    },
    awaitWriteFinish: { stabilityThreshold: SETTLE_MS, pollInterval: 20 },
  })

  const announce = (absolute: string): void => {
    const relative = path.relative(root, absolute).split(path.sep).join('/')

    // Flags ride the same event as Notes. It is not a perfect name, but the
    // client answers both by reloading the Review and the open Draft, and a
    // second event would buy a second identical code path. The one thing this
    // announces is another galley window on the same Review — no agent writes
    // `flags.json` (`docs/adr/0010`).
    if (
      relative === `${SIDECAR_DIRECTORY}/${NOTES_FILE}` ||
      relative === `${SIDECAR_DIRECTORY}/${FLAGS_FILE}`
    ) {
      events.emit({ type: 'notes-changed' })
      return
    }

    const extension = path.extname(relative).toLowerCase()
    if ((DRAFT_EXTENSIONS as readonly string[]).includes(extension)) {
      events.emit({ type: 'draft-changed', path: relative })
    }
  }

  watcher.on('add', announce)
  watcher.on('change', announce)
  watcher.on('unlink', announce)

  return watcher
}
