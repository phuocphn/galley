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
}

/** Everything the client needs to render a Review's sidebar. */
export interface ReviewListing {
  /** Absolute path of the Review root, shown in the UI for orientation. */
  root: string
  /** The Review root's own folder name. */
  name: string
  drafts: DraftSummary[]
}

/** A single Draft's contents. */
export interface DraftContents {
  path: string
  extension: DraftExtension
  content: string
}
