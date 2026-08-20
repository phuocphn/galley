import { afterEach, describe, expect, it } from 'vitest'
import type { DraftContents, Note, Sidecar } from '../src/shared/types.js'
import { createReviewFixture, type ReviewFixture } from './helpers/review-fixture.js'

/**
 * Re-anchoring is the one piece of this tool that fails silently: a Note
 * attached to the wrong sentence looks exactly like one attached to the right
 * sentence. So the cases are enumerated, and every one of them is driven the
 * way an agent would drive it — by rewriting the Draft on disk.
 */

const ORIGINAL = `# Findings

Our model outperforms every published baseline on the benchmark.

We trained it on a curated corpus of 40,000 documents.
`

const PHRASE = 'outperforms every published baseline'

let fixture: ReviewFixture | undefined

afterEach(async () => {
  await fixture?.cleanup()
  fixture = undefined
})

async function noteOnPhrase(
  review: ReviewFixture,
  phrase: string,
  content: string = ORIGINAL,
): Promise<Note> {
  const from = content.indexOf(phrase)
  expect(from, `"${phrase}" is not in the fixture`).toBeGreaterThanOrEqual(0)

  return review.getJson<Note>('/api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      draftPath: 'findings.md',
      from,
      to: from + phrase.length,
      body: 'This claim is unsourced.',
    }),
  })
}

const readDraft = (review: ReviewFixture): Promise<DraftContents> =>
  review.getJson<DraftContents>('/api/draft?path=findings.md')

interface Case {
  name: string
  /** The starting Draft, when the default fixture can't express the case. */
  original?: string
  /** The phrase the Note is attached to, when it isn't the default. */
  phrase?: string
  /** How the agent rewrote the Draft. */
  rewrite: (original: string) => string
  expect: 'exact' | 'reworded' | 'orphaned'
  /** The text the Note should end up covering, when it isn't orphaned. */
  covers?: string
}

/**
 * Genuinely ambiguous repetition is harder to build than it looks: two copies of
 * a sentence are usually told apart by what surrounds them. This block is padded
 * past the context window on both sides, so duplicating it whole leaves the two
 * copies indistinguishable for as far as an Anchor can see.
 */
const PADDING = 'Filler sentence that exists only to push past the context window. '.repeat(4)
const AMBIGUOUS_UNIT = `${PADDING}\nThe claim needs a citation.\n${PADDING}\n`

const CASES: Case[] = [
  {
    name: 'untouched — the text is still exactly where it was',
    rewrite: (original) => original,
    expect: 'exact',
    covers: PHRASE,
  },
  {
    name: 'moved — a section was inserted above, pushing everything down',
    rewrite: (original) => `# Summary\n\nAdded by the agent.\n\n${original}`,
    expect: 'exact',
    covers: PHRASE,
  },
  {
    name: 'moved — the paragraphs were reordered',
    rewrite: (original) => original.split('\n\n').reverse().join('\n\n'),
    expect: 'exact',
    covers: PHRASE,
  },
  {
    name: 'reworded — a hedge was added inside the anchored phrase',
    rewrite: (original) =>
      original.replace(PHRASE, 'outperforms most published baselines'),
    expect: 'reworded',
    covers: 'outperforms most published baselines',
  },
  {
    name: 'reworded — a word was dropped from the anchored phrase',
    rewrite: (original) => original.replace(PHRASE, 'outperforms every baseline'),
    expect: 'reworded',
    covers: 'outperforms every baseline',
  },
  {
    name: 'repeated but differently framed — the context still picks the right copy',
    rewrite: (original) => `${original}\nIn short, our model ${PHRASE} across the board.\n`,
    expect: 'exact',
    covers: PHRASE,
  },
  {
    name: 'ambiguous — two copies with identical surroundings, so it refuses to guess',
    original: AMBIGUOUS_UNIT,
    phrase: 'The claim needs a citation.',
    rewrite: (original) => original + original,
    expect: 'orphaned',
  },
  {
    name: 'missing — the passage was rewritten out of existence',
    rewrite: () => '# Findings\n\nResults were mixed and we make no claims.\n',
    expect: 'orphaned',
  },
  {
    name: 'missing — the whole Draft was replaced with something unrelated',
    rewrite: () => '# Something Else Entirely\n\nNothing to do with the model.\n',
    expect: 'orphaned',
  },
]

describe('re-anchoring a Note after the agent rewrites the Draft', () => {
  for (const testCase of CASES) {
    it(testCase.name, async () => {
      const original = testCase.original ?? ORIGINAL
      const phrase = testCase.phrase ?? PHRASE

      fixture = await createReviewFixture({ 'findings.md': original })
      await noteOnPhrase(fixture, phrase, original)

      await fixture.write('findings.md', testCase.rewrite(original))
      const draft = await readDraft(fixture)
      const [note] = draft.notes

      expect(note!.match).toBe(testCase.expect)

      if (testCase.expect === 'orphaned') {
        expect(note!.range).toBeNull()
      } else {
        expect(note!.range).not.toBeNull()
        expect(draft.content.slice(note!.range!.from, note!.range!.to)).toBe(testCase.covers)
      }
    })
  }

  it('picks the right copy when repeated text is framed differently', async () => {
    const repeated = 'Intro says the thing.\n\nBody says the thing.\n'
    fixture = await createReviewFixture({ 'findings.md': repeated })

    const from = repeated.indexOf('says the thing')
    await fixture.getJson<Note>('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        draftPath: 'findings.md',
        from,
        to: from + 'says the thing'.length,
        body: 'Vague.',
      }),
    })

    await fixture.write('findings.md', `Preface.\n\n${repeated}`)
    const draft = await readDraft(fixture)

    // Only the surrounding context separates the two copies.
    expect(draft.notes[0]!.match).toBe('exact')
    expect(draft.content.slice(0, draft.notes[0]!.range!.from)).toMatch(/Intro $/)
  })
})

describe('the orphaned flag in the sidecar', () => {
  const readSidecar = async (review: ReviewFixture): Promise<Sidecar> =>
    JSON.parse((await review.read('.feedback/notes.json'))!) as Sidecar

  it('is written back so the agent can see the Note came loose', async () => {
    fixture = await createReviewFixture({ 'findings.md': ORIGINAL })
    await noteOnPhrase(fixture, PHRASE)
    expect((await readSidecar(fixture)).notes[0]!.anchor.orphaned).toBeUndefined()

    await fixture.write('findings.md', '# Findings\n\nAll rewritten.\n')
    await readDraft(fixture)

    expect((await readSidecar(fixture)).notes[0]!.anchor.orphaned).toBe(true)
  })

  it('is cleared again if the passage comes back', async () => {
    fixture = await createReviewFixture({ 'findings.md': ORIGINAL })
    await noteOnPhrase(fixture, PHRASE)

    await fixture.write('findings.md', '# Findings\n\nAll rewritten.\n')
    await readDraft(fixture)
    expect((await readSidecar(fixture)).notes[0]!.anchor.orphaned).toBe(true)

    await fixture.write('findings.md', ORIGINAL)
    await readDraft(fixture)

    expect((await readSidecar(fixture)).notes[0]!.anchor.orphaned).toBe(false)
  })

  it('leaves the Note outstanding rather than quietly resolving it', async () => {
    fixture = await createReviewFixture({ 'findings.md': ORIGINAL })
    await noteOnPhrase(fixture, PHRASE)

    await fixture.write('findings.md', '# Findings\n\nAll rewritten.\n')
    const draft = await readDraft(fixture)

    expect(draft.notes[0]!.status).toBe('open')
    expect((await readSidecar(fixture)).notes).toHaveLength(1)
  })
})

describe('re-attaching an Orphaned Note', () => {
  it('anchors it to newly selected text and clears the flag', async () => {
    fixture = await createReviewFixture({ 'findings.md': ORIGINAL })
    const note = await noteOnPhrase(fixture, PHRASE)

    const rewritten = '# Findings\n\nResults were mixed, and we now make a softer claim.\n'
    await fixture.write('findings.md', rewritten)
    expect((await readDraft(fixture)).notes[0]!.match).toBe('orphaned')

    const from = rewritten.indexOf('a softer claim')
    const reattached = await fixture.getJson<Note>(`/api/notes/${note.id}/reanchor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: from + 'a softer claim'.length }),
    })

    expect(reattached.anchor.text).toBe('a softer claim')
    expect(reattached.anchor.orphaned).toBeFalsy()
    expect(reattached.body).toBe('This claim is unsourced.')

    const draft = await readDraft(fixture)
    expect(draft.notes[0]!.match).toBe('exact')
    expect(draft.content.slice(draft.notes[0]!.range!.from, draft.notes[0]!.range!.to)).toBe(
      'a softer claim',
    )
  })

  it('refuses a range that is not in the Draft, and 404s for a Note that is not there', async () => {
    fixture = await createReviewFixture({ 'findings.md': ORIGINAL })
    const note = await noteOnPhrase(fixture, PHRASE)

    const send = (id: string, body: unknown): Promise<Response> =>
      fixture!.request(`/api/notes/${id}/reanchor`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    const offEnd = await send(note.id, { from: 0, to: ORIGINAL.length + 100 })
    const backwards = await send(note.id, { from: 20, to: 10 })
    const missing = await send('nope', { from: 0, to: 5 })

    expect([offEnd.status, backwards.status, missing.status]).toEqual([400, 400, 404])
  })
})
