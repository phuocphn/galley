import { NOTE_KINDS, type Note, type NoteKind } from '../shared/types.js'

/**
 * What a Note asks for when nobody said.
 *
 * Sidecars written before Kinds existed have Notes with no `kind`, and an agent
 * hand-editing the file can leave one off just as easily. Both read as Fix,
 * which is what every Note in those files already meant.
 */
export const DEFAULT_NOTE_KIND: NoteKind = 'fix'

/** The value as a Kind, or undefined if it isn't one. */
export function asNoteKind(value: unknown): NoteKind | undefined {
  return (NOTE_KINDS as readonly unknown[]).includes(value) ? (value as NoteKind) : undefined
}

/** What a Note asks the agent to do, defaulted for Notes that don't say. */
export function kindOf(note: Pick<Note, 'kind'>): NoteKind {
  return asNoteKind(note.kind) ?? DEFAULT_NOTE_KIND
}

/** The same Note with a Kind it can be relied on to have. */
export function withKind(note: Note): Note {
  const kind = kindOf(note)
  return kind === note.kind ? note : { ...note, kind }
}

/** How many outstanding Notes there are of each Kind, in NOTE_KINDS order. */
export function countByKind(notes: Note[]): Map<NoteKind, number> {
  const counts = new Map<NoteKind, number>()
  for (const kind of NOTE_KINDS) {
    const count = notes.filter((note) => kindOf(note) === kind).length
    if (count > 0) counts.set(kind, count)
  }
  return counts
}
