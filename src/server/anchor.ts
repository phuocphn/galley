import type { Anchor } from '../shared/types.js'

/** How much text either side of the anchor is kept to tell repeats apart. */
const CONTEXT_LENGTH = 160

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

function occurrencesOf(content: string, text: string): number[] {
  const found: number[] = []
  let index = content.indexOf(text)
  while (index !== -1) {
    found.push(index)
    index = content.indexOf(text, index + 1)
  }
  return found
}

/** How many characters of `before`/`after` context an occurrence agrees with. */
function contextAgreement(content: string, anchor: Anchor, start: number): number {
  const end = start + anchor.text.length
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

/**
 * Locate an Anchor in a Draft by its text, disambiguating repeats by how much
 * of the surrounding context still agrees. The stored line numbers break a
 * remaining tie but never drive the search — see `docs/adr/0002`.
 *
 * Only exact text matches are found here. Reworded and missing text become
 * Orphaned Notes in a later slice.
 */
export function locateAnchor(
  content: string,
  anchor: Anchor,
): { from: number; to: number } | undefined {
  if (anchor.text === '') return undefined

  const occurrences = occurrencesOf(content, anchor.text)
  if (occurrences.length === 0) return undefined

  let best = occurrences[0]!
  if (occurrences.length > 1) {
    let bestScore = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (const start of occurrences) {
      const score = contextAgreement(content, anchor, start)
      const distance = Math.abs(lineAt(content, start) - anchor.startLine)
      if (score > bestScore || (score === bestScore && distance < bestDistance)) {
        best = start
        bestScore = score
        bestDistance = distance
      }
    }
  }

  return { from: best, to: best + anchor.text.length }
}
