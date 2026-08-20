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
  /** How many Notes on this Draft are still Open. */
  openNoteCount: number
  /** How many the agent has replied to but the reviewer hasn't Resolved. */
  answeredNoteCount: number
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
  /**
   * Set when the anchored text can no longer be found in the Draft — usually
   * because the agent rewrote that passage away. The Note is still outstanding;
   * it just doesn't know where it belongs any more.
   */
  orphaned?: boolean
}

/**
 * Where a Note is in its life.
 *
 * `answered` and `open` follow from the Replies — the agent replies and the
 * Note is Answered; the reviewer replies again and it is back to Open. Only
 * `resolved` is a decision someone made rather than a consequence.
 */
export type NoteStatus = 'open' | 'answered' | 'resolved'

/** Who wrote a Reply. */
export type ReplyAuthor = 'agent' | 'reviewer'

/** A response under a Note: what the agent changed, or the reviewer pushing back. */
export interface Reply {
  id: string
  author: ReplyAuthor
  /** Markdown. */
  body: string
  createdAt: string
}

/** One piece of guidance a reviewer attached to a Draft. */
export interface Note {
  id: string
  /** Path of the Draft this Note is on, relative to the Review root. */
  draftPath: string
  anchor: Anchor
  /** Markdown. */
  body: string
  status: NoteStatus
  replies: Reply[]
  createdAt: string
  updatedAt: string
}

/** A Note with its Anchor located in the Draft as it stands right now. */
export interface ResolvedNote extends Note {
  /** Character offsets into the current Draft, or null if it wasn't found. */
  range: { from: number; to: number } | null
  /**
   * How the Anchor was found. `reworded` means the passage changed but stayed
   * recognisable, which is worth showing the reviewer.
   */
  match: 'exact' | 'reworded' | 'orphaned'
}

/** What the client sends to re-attach an Orphaned Note to new text. */
export interface Reanchor {
  from: number
  to: number
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

/** The instruction the reviewer pastes into their agent. */
export interface Handoff {
  instruction: string
  openNoteCount: number
  answeredNoteCount: number
}

/** What the server pushes when the Review changes underneath the reviewer. */
export type ReviewEvent =
  | { type: 'draft-changed'; path: string }
  | { type: 'notes-changed' }
