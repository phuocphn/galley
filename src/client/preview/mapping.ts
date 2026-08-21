import { marked, type Token } from 'marked'
import { CONTEXT_LENGTH, locateAnchor } from '../../shared/anchor.js'

/**
 * Mapping a passage in the Preview back to the Source it was rendered from.
 *
 * Strings in, ranges out. No DOM, no React, and no knowledge of frames or of
 * the messages they send — which is what makes the part of this feature that
 * can be *silently* wrong the part a test can drive without a browser.
 *
 * Markdown gives exact ranges: `marked`'s top-level tokens each carry their
 * `raw`, so accumulating them gives every rendered block its `[from, to)` in
 * the Source. HTML gives none — sanitising and parsing discard positions — so
 * an HTML passage is found by searching the whole Source for the words that
 * were rendered from it. See `docs/adr/0005`.
 *
 * Those same Markdown ranges answer the other question the two views ask of
 * each other — which block an offset is in, and where a block begins — so
 * switching views lands on the passage being read rather than at the top.
 */

/**
 * Where a Preview gesture landed in the Source.
 *
 * A discriminated union rather than a nullable range, because the outcomes are
 * behaviourally different — `exact` and `reworded` navigate and select in
 * silence, `block` navigates and explains itself, `not-found` does not navigate
 * at all — and the caller must not be able to conflate them. Landing on the
 * wrong passage is worse than not moving.
 */
export type PreviewLocation =
  | { outcome: 'exact'; from: number; to: number }
  | { outcome: 'reworded'; from: number; to: number }
  // Markdown only: an HTML Preview has no blocks to fall back to, so it goes
  // straight from `reworded` to `not-found`.
  | { outcome: 'block'; from: number; to: number }
  | { outcome: 'not-found' }

/** One rendered block of a Markdown Draft, and the Source it came from. */
export interface SourceBlock {
  /** Offset of the block's first character in the Source. */
  from: number
  /** Offset just past its last character. */
  to: number
  /** The token, so the same walk that gives the range also produces the markup. */
  token: Token
}

/** Tokens that carry Source but render nothing, so they are no block to point at. */
const UNRENDERED = new Set(['space', 'def'])

/**
 * The top-level blocks of a Markdown Draft, in document order, each with its
 * exact range in the Source.
 *
 * The ranges and the markup come from this one walk — the caller renders the
 * tokens it is handed here — so the rendered blocks and their Source ranges
 * cannot disagree about where a block begins.
 *
 * A block's range is trimmed of surrounding whitespace, so it covers the text
 * of the block and not the gap after it: an Anchor cut from a heading is the
 * heading, not the heading and the blank line under it.
 */
export function markdownBlocks(source: string): SourceBlock[] {
  const blocks: SourceBlock[] = []
  let at = 0

  for (const token of marked.lexer(source, { gfm: true })) {
    const from = at
    at += token.raw.length
    if (UNRENDERED.has(token.type)) continue

    const trimmed = trimmedRange(source, from, at)
    if (trimmed) blocks.push({ ...trimmed, token })
  }

  return blocks
}

function trimmedRange(source: string, from: number, to: number): { from: number; to: number } | null {
  let start = from
  let end = to
  while (start < end && /\s/.test(source[start]!)) start++
  while (end > start && /\s/.test(source[end - 1]!)) end--
  return end > start ? { from: start, to: end } : null
}

/**
 * Where the block the reviewer clicked came from in the Source.
 *
 * The Preview stamps each rendered block with its index in `markdownBlocks`, so
 * this is a lookup rather than a search — which is why a click on the fourth
 * "Get started" in a Draft lands on the fourth one rather than on a coin toss.
 */
export function locateBlock(source: string, block: number): PreviewLocation {
  const found = markdownBlocks(source)[block]
  if (!found) return { outcome: 'not-found' }
  return { outcome: 'block', from: found.from, to: found.to }
}

/**
 * Which block of the Source an offset falls in.
 *
 * This and `offsetOfBlock` are the pair that keeps the two views on the same
 * passage: the Preview says which block is at the top of what it is showing and
 * this turns the answer round, the Source says what offset is at the top of
 * what it is showing and this turns that into a block. Both read the same
 * ranges the rendered blocks were stamped with, so a switch in one direction
 * and back is a lookup and its inverse rather than two estimates that can
 * disagree — which is what stops repeated switching from walking down a Draft.
 *
 * The whitespace between two blocks belongs to neither, and an offset landing
 * in one of those gaps resolves *forwards*, to the block that starts next. That
 * is the block being read: an offset at the top of a viewport sitting in the
 * blank line under a heading has the paragraph below it filling the screen, not
 * the heading that has just gone off the top. Resolving backwards would also
 * walk a switch cycle up the Draft a block at a time, because a view scrolled
 * so a block sits at its top routinely shows the last pixel of the gap above it.
 *
 * Past the last block there is nothing that starts next, so the last block
 * stands — the trailing newlines of a Draft are still its end.
 */
export function blockAtOffset(source: string, offset: number): number | null {
  const blocks = markdownBlocks(source)
  if (blocks.length === 0) return null

  const found = blocks.findIndex((block) => offset < block.to)
  return found === -1 ? blocks.length - 1 : found
}

/**
 * Where a block begins in the Source, for scrolling the Source view to it.
 *
 * The start rather than anywhere inside it, so that the offset handed back is
 * one `blockAtOffset` resolves to the same block again: a view told to put this
 * offset at its top is a view whose topmost block is this one.
 */
export function offsetOfBlock(source: string, block: number): number | null {
  return markdownBlocks(source)[block]?.from ?? null
}

/** One end of a selection: the block it ran into, and the text selected there. */
export interface SelectedIn {
  block: number
  text: string
}

/** A phrase the reviewer selected in the Preview, as the frame reported it. */
export interface SelectedPhrase {
  start: SelectedIn
  end: SelectedIn
}

/** A phrase found inside one block, in the Source's own coordinates. */
interface FoundInBlock {
  from: number
  to: number
  match: 'exact' | 'reworded'
}

/**
 * Find rendered text inside one block's slice of the Source.
 *
 * Rendered text is not Source text — `**billed monthly**` renders as `billed
 * monthly` — so a phrase spanning bold, a link or inline code has to go through
 * the matcher's fuzzy path. Scoped to one block that is safe: the block range
 * is exact, so the search space is a paragraph rather than a document.
 *
 * The matcher is given no surrounding context, which is deliberate. A phrase
 * that appears twice inside its own block is then a coin toss the matcher
 * declines to call, and the caller falls back to the block — where the reviewer
 * can narrow the selection by hand, having been told why.
 */
function within(source: string, block: SourceBlock, text: string): FoundInBlock | null {
  const phrase = text.trim()
  if (phrase === '') return null

  const located = locateAnchor(source.slice(block.from, block.to), {
    text: phrase,
    before: '',
    after: '',
    startLine: 1,
    endLine: 1,
  })
  if (!located) return null

  return { from: block.from + located.from, to: block.from + located.to, match: located.match }
}

/**
 * Where the phrase the reviewer selected came from in the Source.
 *
 * A selection may run across blocks, and is allowed to: the start phrase is
 * located in the first block and the end phrase in the last, and the Anchor
 * covers everything between — including syntax that was never visible in the
 * Preview. That matches the Source view, where a selection may span anything,
 * and the range shown on arrival makes an over-wide span visible at once.
 * Clamping to the first block is the silent-wrong-answer failure this design
 * refuses everywhere else.
 *
 * When a phrase cannot be pinned the containing block is returned instead,
 * which is always exact. The caller shows that as a selection to narrow rather
 * than as a Note to write.
 */
export function locatePhrase(source: string, selection: SelectedPhrase): PreviewLocation {
  const blocks = markdownBlocks(source)
  const first = blocks[selection.start.block]
  const last = blocks[selection.end.block]
  if (!first || !last || last.to < first.from) return { outcome: 'not-found' }

  const head = within(source, first, selection.start.text)

  if (selection.start.block === selection.end.block) {
    if (!head) return { outcome: 'block', from: first.from, to: first.to }
    return { outcome: head.match, from: head.from, to: head.to }
  }

  const tail = within(source, last, selection.end.text)
  if (!head || !tail) return { outcome: 'block', from: first.from, to: last.to }

  return {
    outcome: head.match === 'exact' && tail.match === 'exact' ? 'exact' : 'reworded',
    from: head.from,
    to: tail.to,
  }
}

/**
 * A passage as the Preview rendered it: the words themselves, and the rendered
 * text either side of them.
 *
 * The same shape the frame reports, restated here rather than imported, so this
 * module goes on knowing nothing about frames or the messages they send — as
 * `SelectedIn` above already does.
 */
export interface RenderedPassage {
  text: string
  before: string
  after: string
}

/**
 * Where rendered text came from in the Source, searched for across the whole of
 * it.
 *
 * This is the HTML path, and the weakest thing in the design. A Markdown phrase
 * is looked for inside one block whose range is exact, so the search space is a
 * paragraph; here there are no blocks, because `DOMPurify.sanitize` and
 * `DOMParser` both throw positions away, so the search space is the document.
 * Rendered text is not Source text either, so anything spanning a tag goes
 * through the matcher's fuzzy path with a whole file to be wrong in. Generated
 * pages do usually carry their prose verbatim, which is why this works more
 * often than not — but "more often than not" is the honest claim.
 *
 * The surrounding rendered text is passed as context, and only earns its keep
 * when the same words appear twice: the matcher reads it to tell exact repeats
 * apart. It usually fails to, because the Source characters at a passage's edge
 * are a tag and the rendered ones are not. That failure is a refusal rather
 * than a guess, which is the point of it.
 *
 * There is no block fallback, because there are no blocks to fall back to. The
 * asymmetry with Markdown is recorded in `docs/adr/0005` and is not an omission:
 * the alternative — pairing Source tags to rendered elements by document order —
 * is correct right up until the sanitiser drops one element, after which every
 * later pairing is off by one and the reviewer lands on the wrong paragraph with
 * nothing to tell them so. `not-found` leaves them where they were reading,
 * which costs them nothing.
 */
export function locateRenderedText(source: string, passage: RenderedPassage): PreviewLocation {
  // Trimming the ends moves that whitespace into the context rather than
  // dropping it, so `before` and `after` still abut the text they are context
  // for.
  const start = passage.text.length - passage.text.trimStart().length
  const end = passage.text.trimEnd().length
  if (end <= start) return { outcome: 'not-found' }

  const located = locateAnchor(source, {
    text: passage.text.slice(start, end),
    before: (passage.before + passage.text.slice(0, start)).slice(-CONTEXT_LENGTH),
    after: (passage.text.slice(end) + passage.after).slice(0, CONTEXT_LENGTH),
    startLine: 1,
    endLine: 1,
  })
  if (!located) return { outcome: 'not-found' }

  return { outcome: located.match, from: located.from, to: located.to }
}
