import { afterEach, describe, expect, it } from 'vitest'
import type { DraftContents, NewNote, Note } from '../src/shared/types.js'
import { createReviewFixture, type ReviewFixture } from './helpers/review-fixture.js'

/**
 * Phrase-level Anchors: a Note created from a text selection covers exactly the
 * characters that were selected, not the line they happened to sit on.
 *
 * Prose is why this matters — line 3 below is a single 200-character paragraph
 * carrying two separate problems, and a line-sized Anchor could not tell them
 * apart.
 */
const DRAFT = `# Findings

The model was trained on a curated corpus of 40,000 documents and outperforms every published baseline by a wide margin, which makes it the strongest system available today.

## Method

The model was trained on a curated corpus of 40,000 documents.
`

let fixture: ReviewFixture | undefined

afterEach(async () => {
  await fixture?.cleanup()
  fixture = undefined
})

const draftUrl = (draftPath: string) => `/api/draft?${new URLSearchParams({ path: draftPath })}`

/** Attach a Note to one phrase, the way the selection button submits one. */
async function noteOnPhrase(
  review: ReviewFixture,
  draftPath: string,
  content: string,
  phrase: string,
  body: string,
  { occurrence = 0 }: { occurrence?: number } = {},
): Promise<Note> {
  let from = -1
  for (let i = 0; i <= occurrence; i++) from = content.indexOf(phrase, from + 1)
  expect(from, `"${phrase}" #${occurrence} is not in the fixture Draft`).toBeGreaterThanOrEqual(0)

  const submission: NewNote = { draftPath, from, to: from + phrase.length, body }
  return review.getJson<Note>('/api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(submission),
  })
}

/** The Draft as the client would fetch it after a reload, Notes re-anchored. */
async function reload(review: ReviewFixture, draftPath: string): Promise<DraftContents> {
  return review.getJson<DraftContents>(draftUrl(draftPath))
}

function textAt(draft: DraftContents, note: DraftContents['notes'][number]): string {
  expect(note.range, `Note "${note.body}" lost its Anchor`).not.toBeNull()
  return draft.content.slice(note.range!.from, note.range!.to)
}

const PHRASE = 'outperforms every published baseline'

describe('anchoring a Note to a phrase', () => {
  it('covers exactly the selected text, not the line it sits on', async () => {
    fixture = await createReviewFixture({ 'findings.md': DRAFT })

    const note = await noteOnPhrase(fixture, 'findings.md', DRAFT, PHRASE, 'Unsourced claim.')

    expect(note.anchor!.text).toBe(PHRASE)
    // Same line at both ends, and far shorter than that line.
    expect(note.anchor!.startLine).toBe(3)
    expect(note.anchor!.endLine).toBe(3)
    const line = DRAFT.split('\n')[2]!
    expect(note.anchor!.text.length).toBeLessThan(line.length)
    expect(line).toContain(note.anchor!.text)
  })

  it('re-finds the phrase after the Draft is reloaded', async () => {
    fixture = await createReviewFixture({ 'findings.md': DRAFT })
    await noteOnPhrase(fixture, 'findings.md', DRAFT, PHRASE, 'Unsourced claim.')

    // The agent adds a section above, so every stored line number is now wrong.
    const rewritten = `# Findings\n\n## Summary\n\nShort version first.\n${DRAFT.slice('# Findings\n'.length)}`
    await fixture.write('findings.md', rewritten)

    const draft = await reload(fixture, 'findings.md')
    const [note] = draft.notes

    expect(textAt(draft, note!)).toBe(PHRASE)
    // Still sub-line: the Anchor starts after the line it lives on begins.
    const lineStart = draft.content.lastIndexOf('\n', note!.range!.from - 1) + 1
    expect(note!.range!.from).toBeGreaterThan(lineStart)
  })

  it('keeps two Notes on the same line pointing at their own phrases', async () => {
    fixture = await createReviewFixture({ 'findings.md': DRAFT })

    const corpus = 'a curated corpus of 40,000 documents'
    await noteOnPhrase(fixture, 'findings.md', DRAFT, corpus, 'Say where it came from.')
    await noteOnPhrase(fixture, 'findings.md', DRAFT, PHRASE, 'Unsourced claim.')

    const draft = await reload(fixture, 'findings.md')
    const [first, second] = draft.notes

    expect(textAt(draft, first!)).toBe(corpus)
    expect(textAt(draft, second!)).toBe(PHRASE)
    // Both on line 3, and not overlapping each other.
    expect([first!.anchor!.startLine, second!.anchor!.startLine]).toEqual([3, 3])
    expect(first!.range!.to).toBeLessThan(second!.range!.from)
  })

  it('tells two identical phrases apart by what surrounds them', async () => {
    fixture = await createReviewFixture({ 'findings.md': DRAFT })

    const repeated = 'a curated corpus of 40,000 documents'
    // The same words appear on line 3 and again on line 7; only the context
    // stored with each Anchor says which one the reviewer meant.
    const inFindings = await noteOnPhrase(
      fixture,
      'findings.md',
      DRAFT,
      repeated,
      'Which documents?',
    )
    const inMethod = await noteOnPhrase(
      fixture,
      'findings.md',
      DRAFT,
      repeated,
      'Repeated verbatim from Findings.',
      { occurrence: 1 },
    )
    expect(inFindings.anchor!.startLine).toBe(3)
    expect(inMethod.anchor!.startLine).toBe(7)

    const draft = await reload(fixture, 'findings.md')
    const found = Object.fromEntries(
      draft.notes.map((note) => [note.body, note.range!.from]),
    )

    expect(found['Which documents?']).toBe(DRAFT.indexOf(repeated))
    expect(found['Repeated verbatim from Findings.']).toBe(
      DRAFT.indexOf(repeated, DRAFT.indexOf(repeated) + 1),
    )
  })
})
