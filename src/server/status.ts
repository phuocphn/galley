import type { Note, NoteStatus } from '../shared/types.js'

/**
 * What a Note's Status actually is, given its Replies.
 *
 * The Status is stored in the sidecar so it reads clearly to a human, but it is
 * normalised on the way out: an agent that appends a Reply and forgets to touch
 * `status` still leaves the Note showing as Answered, which is what the
 * reviewer needs to see. Resolving is the one transition nothing infers.
 */
export function statusOf(note: Pick<Note, 'status' | 'replies'>): NoteStatus {
  if (note.status === 'resolved') return 'resolved'

  const last = note.replies.at(-1)
  if (!last) return 'open'
  return last.author === 'agent' ? 'answered' : 'open'
}

/** The same Note with its Status brought in line with its Replies. */
export function normalised(note: Note): Note {
  const status = statusOf(note)
  return status === note.status ? note : { ...note, status }
}

/** A Note the reviewer still has work to do on. */
export function isOutstanding(note: Note): boolean {
  return statusOf(note) !== 'resolved'
}
