/** The formats a Draft can be. */
export const DRAFT_EXTENSIONS = ['.md', '.html', '.txt'] as const

export type DraftExtension = (typeof DRAFT_EXTENSIONS)[number]

/** One Draft in a Review, as listed in the sidebar. */
export interface DraftSummary {
  /** Path relative to the Review root, using forward slashes. */
  path: string
  /** The file's own name, without its directory. */
  name: string
  extension: DraftExtension
  /** How many Notes on this Draft are still open. */
  openNoteCount: number
}

/** Everything the client needs to render a Review's sidebar. */
export interface ReviewListing {
  /** Absolute path of the Review root, shown in the UI for orientation. */
  root: string
  /** The Review root's own folder name. */
  name: string
  drafts: DraftSummary[]
}

/** A single Draft's contents, with its Notes located in the current text. */
export interface DraftContents {
  path: string
  extension: DraftExtension
  content: string
  notes: ResolvedNote[]
}

/**
 * Where a Note is attached. The text is authoritative; the line numbers are a
 * hint for humans reading the sidecar, and are never used to locate the Note.
 */
export interface Anchor {
  /** The exact text the Note was attached to. */
  text: string
  /** Text immediately before the anchor, used to tell repeats apart. */
  before: string
  /** Text immediately after the anchor, used to tell repeats apart. */
  after: string
  /** 1-based line the anchor started on when the Note was written. */
  startLine: number
  /** 1-based line the anchor ended on when the Note was written. */
  endLine: number
}

/** Where a Note is in its life. Widens as the agent gets involved. */
export type NoteStatus = 'open'

/** One piece of guidance a reviewer attached to a Draft. */
export interface Note {
  id: string
  /** Path of the Draft this Note is on, relative to the Review root. */
  draftPath: string
  anchor: Anchor
  /** Markdown. */
  body: string
  status: NoteStatus
  createdAt: string
  updatedAt: string
}

/** A Note with its Anchor located in the Draft as it stands right now. */
export interface ResolvedNote extends Note {
  /** Character offsets into the current Draft, or null if it wasn't found. */
  range: { from: number; to: number } | null
}

/** What the client sends to attach a new Note. */
export interface NewNote {
  draftPath: string
  /** Character offsets into the Draft as the client currently has it. */
  from: number
  to: number
  body: string
}

/** The shape of `.feedback/notes.json`. */
export interface Sidecar {
  version: 1
  notes: Note[]
}
