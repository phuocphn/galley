/**
 * The Anchor matcher: cutting an Anchor from a Draft, and finding it again.
 *
 * Shared rather than the server's own, because the Preview maps a rendered
 * passage back to the Source with the same matcher the server re-anchors with —
 * see `docs/adr/0005`. Pure, and dependent only on shared types, so both sides
 * run the identical rules and a Note cannot mean one thing on the way in and
 * another on the way back.
 */
import type { Anchor } from './types.js'

/** How much text either side of the anchor is kept to tell repeats apart. */
const CONTEXT_LENGTH = 160

/** Below this similarity a reworded passage is a different passage. */
const REWORD_THRESHOLD = 0.72

/** Two candidates this close together are a coin toss, so we decline to guess. */
const DECISIVE_MARGIN = 0.06

/** Fuzzy matching is quadratic; past this the Anchor has to match exactly. */
const FUZZY_LENGTH_LIMIT = 2000

/** Seed positions to explore before giving up. */
const MAX_CANDIDATES = 64

/** How far a reworded passage may shrink or grow and still be the same passage. */
const LENGTH_SLACK = 0.5

/** Where a Note ended up, and how sure we are it's the right place. */
export interface Located {
  from: number
  to: number
  /** `exact` — the text is still there verbatim. `reworded` — close enough. */
  match: 'exact' | 'reworded'
}

/** Build an Anchor from a range of a Draft as it stands right now. */
export function captureAnchor(content: string, from: number, to: number): Anchor {
  const start = Math.max(0, Math.min(from, to))
  const end = Math.min(content.length, Math.max(from, to))

  return {
    text: content.slice(start, end),
    before: content.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    after: content.slice(end, end + CONTEXT_LENGTH),
    startLine: lineAt(content, start),
    endLine: lineAt(content, Math.max(start, end - 1)),
  }
}

/** The 1-based line an offset falls on. */
function lineAt(content: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') line++
  }
  return line
}

function occurrencesOf(content: string, text: string, cap = MAX_CANDIDATES): number[] {
  const found: number[] = []
  let index = content.indexOf(text)
  while (index !== -1 && found.length < cap) {
    found.push(index)
    index = content.indexOf(text, index + 1)
  }
  return found
}

/** How many characters of `before`/`after` context an occurrence agrees with. */
function contextAgreement(content: string, anchor: Anchor, start: number, length: number): number {
  const end = start + length
  const actualBefore = content.slice(Math.max(0, start - anchor.before.length), start)
  const actualAfter = content.slice(end, end + anchor.after.length)

  let score = 0
  const beforeLength = Math.min(actualBefore.length, anchor.before.length)
  for (let i = 1; i <= beforeLength; i++) {
    if (actualBefore[actualBefore.length - i] !== anchor.before[anchor.before.length - i]) break
    score++
  }
  const afterLength = Math.min(actualAfter.length, anchor.after.length)
  for (let i = 0; i < afterLength; i++) {
    if (actualAfter[i] !== anchor.after[i]) break
    score++
  }
  return score
}

/** Levenshtein distance, bounded by the shorter of the two rows. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  let current = new Array<number>(b.length + 1)

  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, substitution)
    }
    ;[previous, current] = [current, previous]
  }

  return previous[b.length]!
}

/** 0 to 1, where 1 is identical. */
function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length)
  return longest === 0 ? 1 : 1 - editDistance(a, b) / longest
}

/**
 * A distinctive word from the Anchor, used to find candidate windows without
 * scanning every offset in the Draft. The longest word is the least likely to
 * be a preposition that appears in every sentence.
 */
function seedOf(text: string): { seed: string; offset: number } | undefined {
  let best: { seed: string; offset: number } | undefined

  for (const match of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    const word = match[0]
    if (word.length < 4) continue
    if (!best || word.length > best.seed.length) {
      best = { seed: word, offset: match.index }
    }
  }

  return best
}

/**
 * Word boundaries in `[from, to]`, as candidate ends for a reworded window.
 *
 * The window cannot just be the Anchor's old length laid over the new text:
 * rewording routinely adds or drops words, and a fixed length then measures the
 * passage against itself-plus-the-next-few-words, which scores as a poor match
 * even when the passage is obviously the same one.
 */
function wordBoundariesBetween(content: string, from: number, to: number): number[] {
  const boundaries: number[] = []
  const end = Math.min(content.length, to)

  for (let at = Math.max(0, from); at <= end; at++) {
    const before = content[at - 1]
    const after = content[at]
    const isBoundary =
      at === content.length || before === undefined || !/[\p{L}\p{N}]/u.test(before) || !/[\p{L}\p{N}]/u.test(after ?? ' ')
    if (isBoundary) boundaries.push(at)
  }

  return boundaries
}

/** Candidate windows for a reworded Anchor, scored by similarity. */
function rewordCandidates(content: string, anchor: Anchor): { start: number; end: number; score: number }[] {
  if (anchor.text.length > FUZZY_LENGTH_LIMIT) return []

  const seed = seedOf(anchor.text)
  if (!seed) return []

  const length = anchor.text.length
  const shortest = Math.max(1, Math.floor(length * (1 - LENGTH_SLACK)))
  const longest = Math.ceil(length * (1 + LENGTH_SLACK))

  const best: { start: number; end: number; score: number }[] = []

  for (const seedAt of occurrencesOf(content, seed.seed)) {
    const start = Math.max(0, Math.min(content.length, seedAt - seed.offset))

    let bestHere: { start: number; end: number; score: number } | undefined
    for (const end of wordBoundariesBetween(content, start + shortest, start + longest)) {
      const score = similarity(anchor.text, content.slice(start, end))
      if (!bestHere || score > bestHere.score) bestHere = { start, end, score }
    }

    if (bestHere) best.push(bestHere)
  }

  return best.sort((a, b) => b.score - a.score)
}

/**
 * Locate an Anchor in the Draft as it stands now.
 *
 * The text is what locates a Note, not its line numbers — see `docs/adr/0002`.
 * Exact matches win; a lightly reworded passage is accepted when it is close
 * enough; and when two places are equally good the Note is left Orphaned rather
 * than attached to the wrong one. Guessing wrong is worse than admitting we
 * don't know, because a Note silently pointing at the wrong sentence is
 * indistinguishable from one pointing at the right one.
 */
export function locateAnchor(content: string, anchor: Anchor): Located | undefined {
  if (anchor.text === '') return undefined

  const exact = occurrencesOf(content, anchor.text)

  if (exact.length === 1) {
    return { from: exact[0]!, to: exact[0]! + anchor.text.length, match: 'exact' }
  }

  if (exact.length > 1) {
    // Repeated text: only the surrounding context can tell the copies apart.
    const scored = exact
      .map((start) => ({
        start,
        score: contextAgreement(content, anchor, start, anchor.text.length),
      }))
      .sort((a, b) => b.score - a.score)

    const [best, runnerUp] = scored
    if (!best || (runnerUp && runnerUp.score === best.score)) return undefined
    return { from: best.start, to: best.start + anchor.text.length, match: 'exact' }
  }

  const reworded = rewordCandidates(content, anchor)
  const [best, runnerUp] = reworded
  if (!best || best.score < REWORD_THRESHOLD) return undefined
  if (runnerUp && best.score - runnerUp.score < DECISIVE_MARGIN) return undefined

  return trimToWords(content, best.start, best.end)
}

/**
 * Pull a fuzzy window in to whole words. The window is the Anchor's old length
 * laid over new text, so its edges routinely land mid-word.
 */
function trimToWords(content: string, from: number, to: number): Located {
  const isWordish = (character: string | undefined): boolean =>
    character !== undefined && /[\p{L}\p{N}]/u.test(character)

  let start = Math.max(0, from)
  let end = Math.min(content.length, to)

  while (start < end && isWordish(content[start - 1]) && isWordish(content[start])) start++
  while (end > start && isWordish(content[end - 1]) && isWordish(content[end])) end--

  while (start < end && /\s/.test(content[start]!)) start++
  while (end > start && /\s/.test(content[end - 1]!)) end--

  return { from: start, to: end, match: 'reworded' }
}
