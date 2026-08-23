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

/**
 * How much text either side of the anchor is kept to tell repeats apart.
 *
 * Exported because the Preview frame reports rendered context for an HTML
 * Draft, and context the matcher never reads is bytes over `postMessage` for
 * nothing.
 */
export const CONTEXT_LENGTH = 160

/** Below this similarity a reworded passage is a different passage. */
const REWORD_THRESHOLD = 0.72

/** Two candidates this close together are a coin toss, so we decline to guess. */
const DECISIVE_MARGIN = 0.06

/** Fuzzy matching is quadratic; past this the Anchor has to match exactly. */
const FUZZY_LENGTH_LIMIT = 2000

/**
 * How much comparison one Anchor may cost before we stop looking, counted in
 * cells of the distance matrix.
 *
 * A long Anchor whose passage is genuinely gone is the worst case there is: no
 * window is a good match, so no window ever tightens the search, and the seed
 * still has to be tried everywhere it appears. Past this much work we decline to
 * keep guessing and the Note comes back Orphaned — which is the same answer the
 * search was overwhelmingly likely to reach anyway, and the same bargain
 * `FUZZY_LENGTH_LIMIT` already strikes on length. The Note is not lost: it is
 * pinned for re-attachment, and a reviewer pointing at the new passage is both
 * quicker and more certain than any amount of further searching.
 *
 * Set well clear of what a real Review costs — the heaviest Anchor in the paper
 * this was measured on came to 39M — so that it bounds the pathological case
 * without touching the ordinary one.
 */
const FUZZY_WORK_LIMIT = 50_000_000

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

/** Stands in for "further than we are willing to look" inside the DP rows. */
const UNREACHABLE = 0x3fffffff

/**
 * Levenshtein distance, given up on as soon as it exceeds `ceiling`.
 *
 * Every caller here is asking a yes/no question — is this window close enough to
 * be the same passage? — so the exact distance of a window that is plainly too
 * far is of no interest. Only the diagonal band within `ceiling` of the leading
 * edge can hold a result that small, so the rest of each row is never computed,
 * and a row whose best cell is already past the ceiling ends the search.
 *
 * Returns `Infinity` for "further than `ceiling`", which is a real answer and
 * not a failure: it is what lets the caller skip the window.
 */
function editDistanceWithin(a: string, b: string, ceiling: number): number {
  if (a === b) return 0
  // A length difference is a lower bound on the distance all by itself.
  if (Math.abs(a.length - b.length) > ceiling) return Infinity
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const width = b.length
  let previous = new Int32Array(width + 1)
  let current = new Int32Array(width + 1)
  for (let j = 0; j <= width; j++) previous[j] = j > ceiling ? UNREACHABLE : j

  for (let i = 1; i <= a.length; i++) {
    const from = Math.max(1, i - ceiling)
    const to = Math.min(width, i + ceiling)

    current[0] = i <= ceiling ? i : UNREACHABLE
    if (from - 1 >= 1) current[from - 1] = UNREACHABLE

    let best = UNREACHABLE
    const left = a.charCodeAt(i - 1)
    for (let j = from; j <= to; j++) {
      const substitution = previous[j - 1]! + (left === b.charCodeAt(j - 1) ? 0 : 1)
      const deletion = previous[j]! + 1
      const insertion = current[j - 1]! + 1
      const cell = Math.min(substitution, deletion, insertion)
      current[j] = cell
      if (cell < best) best = cell
    }
    if (to + 1 <= width) current[to + 1] = UNREACHABLE

    // Distances never shrink as rows are added, so once the whole row is past
    // the ceiling nothing below it can come back under.
    if (best > ceiling) return Infinity
    ;[previous, current] = [current, previous]
  }

  const distance = previous[width]!
  return distance > ceiling ? Infinity : distance
}

/**
 * A lower bound on the edit distance, from the characters alone.
 *
 * Two strings cannot be closer than the characters they fail to share, and
 * counting those is linear where the real distance is quadratic. Almost every
 * candidate window in a Draft is obviously wrong, and this is what makes
 * discarding one cost nothing.
 */
function unsharedCharacters(a: string, b: string): number {
  const counts = new Map<number, number>()
  for (let i = 0; i < a.length; i++) {
    const code = a.charCodeAt(i)
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }

  let shared = 0
  for (let i = 0; i < b.length; i++) {
    const remaining = counts.get(b.charCodeAt(i))
    if (remaining === undefined || remaining === 0) continue
    counts.set(b.charCodeAt(i), remaining - 1)
    shared++
  }

  return Math.max(a.length, b.length) - shared
}

/**
 * 0 to 1, where 1 is identical — or `undefined` for "below `floor`", which is
 * how a window we were never going to accept is dismissed without measuring it.
 */
function similarity(a: string, b: string, floor: number): number | undefined {
  const longest = Math.max(a.length, b.length)
  if (longest === 0) return 1

  const ceiling = Math.floor(longest * (1 - floor))
  if (ceiling < 0) return undefined
  if (unsharedCharacters(a, b) > ceiling) return undefined

  const distance = editDistanceWithin(a, b, ceiling)
  return distance === Infinity ? undefined : 1 - distance / longest
}

/**
 * How many words to weigh up as a seed. Not a tuning knob — a bound on the
 * worst case, for a very long Anchor in a very long Draft, where counting every
 * word's occurrences would cost more than the search it is meant to shorten.
 */
const SEED_CANDIDATES = 48

/**
 * A distinctive word from the Anchor, used to find candidate windows without
 * scanning every offset in the Draft.
 *
 * Distinctive means rare *in this Draft*, which is the thing that actually
 * matters and is cheap to measure. Picking the longest word instead — the old
 * rule — reads as a proxy for the same idea and behaves as the opposite of it:
 * the longest word in a paper is routinely the paper's own subject, which is in
 * every other paragraph. On a real Review the seed came out as the project's
 * name, 22 occurrences, and every one of them was a window to score.
 *
 * The longest few words are what get counted, because a word has to be long
 * enough to be worth searching for before it is worth asking how rare it is.
 */
function seedOf(text: string, content: string): { seed: string; offset: number } | undefined {
  const words: { seed: string; offset: number }[] = []
  for (const match of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu)) {
    if (match[0].length < 4) continue
    words.push({ seed: match[0], offset: match.index })
  }
  if (words.length === 0) return undefined

  const longest = [...words].sort((a, b) => b.seed.length - a.seed.length).slice(0, SEED_CANDIDATES)

  let best: { seed: string; offset: number } | undefined
  let fewest = Infinity
  for (const word of longest) {
    const occurrences = occurrencesOf(content, word.seed, MAX_CANDIDATES + 1).length
    // A word that isn't in the Draft at all seeds nothing, so it is no help.
    if (occurrences === 0) continue
    if (occurrences < fewest) {
      best = word
      fewest = occurrences
      // One occurrence is one window to score. Nothing beats that, and the
      // longest such word is reached first, so there is no reason to look on.
      if (fewest === 1) break
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

  const seed = seedOf(anchor.text, content)
  if (!seed) return []

  const length = anchor.text.length

  // Two windows cannot be more similar than their lengths allow: an edit
  // distance is at least the difference in length, so a window outside
  // [T·L, L/T] can never reach REWORD_THRESHOLD however well its text reads.
  // LENGTH_SLACK is the looser rule of the two, so it is where scoring stops
  // and this is where scoring never began.
  const shortest = Math.max(
    Math.max(1, Math.floor(length * (1 - LENGTH_SLACK))),
    Math.ceil(length * REWORD_THRESHOLD),
  )
  const longest = Math.min(
    Math.ceil(length * (1 + LENGTH_SLACK)),
    Math.floor(length / REWORD_THRESHOLD),
  )

  // A candidate below this is neither an answer nor close enough to a better
  // one to make it a coin toss, so it can be dropped without being measured.
  const worthScoring = REWORD_THRESHOLD - DECISIVE_MARGIN

  const best: { start: number; end: number; score: number }[] = []
  let spent = 0

  for (const seedAt of occurrencesOf(content, seed.seed)) {
    if (spent > FUZZY_WORK_LIMIT) break
    const start = Math.max(0, Math.min(content.length, seedAt - seed.offset))

    let bestHere: { start: number; end: number; score: number } | undefined
    for (const end of wordBoundariesBetween(content, start + shortest, start + longest)) {
      if (spent > FUZZY_WORK_LIMIT) break

      const floor = bestHere ? Math.max(bestHere.score, worthScoring) : worthScoring
      // What this window is about to cost, charged before it is spent: the
      // matrix is as wide as the window and as tall as the band we search.
      const span = Math.max(length, end - start)
      spent += length * Math.min(span, 2 * Math.floor(span * (1 - floor)) + 1)

      const score = similarity(anchor.text, content.slice(start, end), floor)
      if (score !== undefined && (!bestHere || score > bestHere.score)) {
        bestHere = { start, end, score }
      }
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
