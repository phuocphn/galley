import type { Note } from './types.js'

/**
 * How far a Note reaches.
 *
 * - `range` — a passage of one Draft.
 * - `draft` — one whole Draft.
 * - `review` — every Draft in the Review.
 */
export type NoteScope = 'range' | 'draft' | 'review'

/**
 * A Note's Scope, worked out from what it has rather than read off a field.
 *
 * There is deliberately no `scope` in the sidecar: an Anchor and a Draft path
 * already say everything a Scope would, and a stored fourth field could
 * disagree with them — an agent that rewrites a Note or a reviewer editing the
 * JSON by hand would have two things to keep in step instead of one.
 */
export function scopeOf(note: Pick<Note, 'draftPath' | 'anchor'>): NoteScope {
  if (!note.draftPath) return 'review'
  return note.anchor ? 'range' : 'draft'
}
