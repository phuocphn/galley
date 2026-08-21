import { marked, type Token } from 'marked'
import { locateAnchor } from '../../shared/anchor.js'

/**
 * Mapping a passage in the Preview back to the Source it was rendered from.
 *
 * Strings in, ranges out. No DOM, no React, and no knowledge of frames or of
 * the messages they send — which is what makes the part of this feature that
 * can be *silently* wrong the part a test can drive without a browser.
 *
 * Markdown gives exact ranges: `marked`'s top-level tokens each carry their
 * `raw`, so accumulating them gives every rendered block its `[from, to)` in
 * the Source. See `docs/adr/0005`.
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
