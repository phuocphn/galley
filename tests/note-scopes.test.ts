import { afterEach, describe, expect, it } from 'vitest'
import { scopeOf } from '../src/shared/scope.js'
import type {
  DraftContents,
  Handoff,
  Note,
  ReviewListing,
  Sidecar,
} from '../src/shared/types.js'
import { createReviewFixture, type ReviewFixture } from './helpers/review-fixture.js'

const DRAFT = `# Release notes

We shipped three things this week, and they are all great.

## Details

Nothing further to report.
`

const OTHER = `# Setup

Install it — then run it.
`

let fixture: ReviewFixture | undefined

afterEach(async () => {
  await fixture?.cleanup()
  fixture = undefined
})

const draftUrl = (draftPath: string) => `/api/draft?${new URLSearchParams({ path: draftPath })}`

function json(method: string, value: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }
}

/** A Note on a passage: a Draft path and a range. */
function rangeNote(
  review: ReviewFixture,
  draftPath: string,
  content: string,
  phrase: string,
  body: string,
): Promise<Note> {
  const from = content.indexOf(phrase)
  expect(from, `"${phrase}" is not in the fixture Draft`).toBeGreaterThanOrEqual(0)
  return review.getJson<Note>(
    '/api/notes',
    json('POST', { draftPath, from, to: from + phrase.length, body }),
  )
}

/** A Note on a whole Draft: a Draft path and nothing else. */
function draftNote(review: ReviewFixture, draftPath: string, body: string): Promise<Note> {
  return review.getJson<Note>('/api/notes', json('POST', { draftPath, body }))
}

/** A Note on the whole Review: no Draft path at all. */
function reviewNote(review: ReviewFixture, body: string): Promise<Note> {
  return review.getJson<Note>('/api/notes', json('POST', { body }))
}

async function readSidecar(review: ReviewFixture): Promise<Sidecar | undefined> {
  const raw = await review.read('.feedback/notes.json')
  return raw ? (JSON.parse(raw) as Sidecar) : undefined
}

describe('leaving a Note at each Scope', () => {
  it('attaches a range Note to a passage of one Draft', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const note = await rangeNote(fixture, 'notes.md', DRAFT, 'three things', 'Which three?')

    expect(scopeOf(note)).toBe('range')
    expect(note.draftPath).toBe('notes.md')
    expect(note.anchor?.text).toBe('three things')
  })

  it('attaches a Draft Note to a whole Draft, with no Anchor at all', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const note = await draftNote(fixture, 'notes.md', 'This file needs a summary section.')

    expect(scopeOf(note)).toBe('draft')
    expect(note.draftPath).toBe('notes.md')
    expect(note.anchor).toBeUndefined()
    expect(note.status).toBe('open')
    expect(note.body).toBe('This file needs a summary section.')
  })

  it('attaches a Review Note to no Draft at all', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const note = await reviewNote(fixture, 'Stop using em dashes anywhere.')

    expect(scopeOf(note)).toBe('review')
    expect(note.draftPath).toBeUndefined()
    expect(note.anchor).toBeUndefined()
    expect(note.status).toBe('open')
  })

  it('writes all three into one sidecar, with the Scope left to be derived', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    await rangeNote(fixture, 'notes.md', DRAFT, 'three things', 'Which three?')
    await draftNote(fixture, 'notes.md', 'Needs a summary section.')
    await reviewNote(fixture, 'Stop using em dashes.')

    const sidecar = await readSidecar(fixture)
    expect(sidecar?.notes.map(scopeOf)).toEqual(['range', 'draft', 'review'])
    // Derived means derived: nothing on disk spells the Scope out.
    for (const note of sidecar!.notes) {
      expect(Object.keys(note)).not.toContain('scope')
    }
    expect(Object.keys(sidecar!.notes[1]!)).not.toContain('anchor')
    expect(Object.keys(sidecar!.notes[2]!)).not.toContain('draftPath')
  })

  it('reads a Draft Note back with the Draft it is about', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT, 'setup.md': OTHER })
    await draftNote(fixture, 'notes.md', 'Needs a summary section.')
    await draftNote(fixture, 'setup.md', 'Needs a prerequisites list.')

    const draft = await fixture.getJson<DraftContents>(draftUrl('notes.md'))

    expect(draft.notes).toHaveLength(1)
    expect(draft.notes[0]!.body).toBe('Needs a summary section.')
  })

  it('reads Review Notes back from the Review, not from any one Draft', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT, 'setup.md': OTHER })
    await reviewNote(fixture, 'Stop using em dashes anywhere.')

    const review = await fixture.getJson<ReviewListing>('/api/review')
    const notes = await fixture.getJson<DraftContents>(draftUrl('notes.md'))
    const setup = await fixture.getJson<DraftContents>(draftUrl('setup.md'))

    expect(review.reviewNotes.map((note) => note.body)).toEqual(['Stop using em dashes anywhere.'])
    expect(notes.notes).toEqual([])
    expect(setup.notes).toEqual([])
  })
})

describe('a Draft Note is not an Orphaned Note', () => {
  it('comes back unanchored rather than orphaned', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    await draftNote(fixture, 'notes.md', 'Needs a summary section.')

    const draft = await fixture.getJson<DraftContents>(draftUrl('notes.md'))

    const [note] = draft.notes
    expect(note!.match).toBe('unanchored')
    expect(note!.match).not.toBe('orphaned')
    expect(note!.range).toBeNull()
    expect(note!.anchor).toBeUndefined()
  })

  it('is never given an Anchor flagged as orphaned in the sidecar', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    await draftNote(fixture, 'notes.md', 'Needs a summary section.')

    // Reading is what records orphans, and rewriting the Draft is what makes
    // them. Neither may invent an Anchor for a Note that never had one.
    await fixture.getJson<DraftContents>(draftUrl('notes.md'))
    await fixture.write('notes.md', '# Release notes\n\nCompletely rewritten.\n')
    await fixture.getJson<DraftContents>(draftUrl('notes.md'))

    const stored = (await readSidecar(fixture))!.notes[0]!
    expect(stored.anchor).toBeUndefined()
    expect(scopeOf(stored)).toBe('draft')
  })

  it('still lets a range Note on the same Draft be orphaned', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const ranged = await rangeNote(fixture, 'notes.md', DRAFT, 'three things', 'Which three?')
    const whole = await draftNote(fixture, 'notes.md', 'Needs a summary section.')

    await fixture.write('notes.md', '# Release notes\n\nCompletely rewritten.\n')
    const draft = await fixture.getJson<DraftContents>(draftUrl('notes.md'))

    const byId = Object.fromEntries(draft.notes.map((note) => [note.id, note]))
    expect(byId[ranged.id]!.match).toBe('orphaned')
    expect(byId[ranged.id]!.anchor!.orphaned).toBe(true)
    expect(byId[whole.id]!.match).toBe('unanchored')
  })
})

describe('counting a Review with a mix of Scopes', () => {
  it('counts Draft Notes on their Draft and Review Notes in the sidebar', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT, 'setup.md': OTHER })
    await rangeNote(fixture, 'notes.md', DRAFT, 'three things', 'Which three?')
    await draftNote(fixture, 'notes.md', 'Needs a summary section.')
    await draftNote(fixture, 'setup.md', 'Needs a prerequisites list.')
    await reviewNote(fixture, 'Stop using em dashes anywhere.')
    await reviewNote(fixture, 'Every file needs a title.')

    const review = await fixture.getJson<ReviewListing>('/api/review')

    const counts = Object.fromEntries(
      review.drafts.map((draft) => [draft.path, draft.openNoteCount]),
    )
    expect(counts).toEqual({ 'notes.md': 2, 'setup.md': 1 })
    expect(review.reviewNotes).toHaveLength(2)
    expect(review.reviewNotes.every((note) => note.status === 'open')).toBe(true)

    // Nothing is lost between the two: every outstanding Note is counted once.
    const inDrafts = review.drafts.reduce((total, draft) => total + draft.openNoteCount, 0)
    const handoff = await fixture.getJson<Handoff>('/api/handoff')
    expect(inDrafts + review.reviewNotes.length).toBe(handoff.openNoteCount)
    expect(handoff.openNoteCount).toBe(5)
  })

  it('follows each Scope through open → answered → resolved', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const whole = await draftNote(fixture, 'notes.md', 'Needs a summary section.')
    const everywhere = await reviewNote(fixture, 'Stop using em dashes anywhere.')

    for (const note of [whole, everywhere]) {
      const answered = await fixture.getJson<Note>(
        `/api/notes/${note.id}/replies`,
        json('POST', { author: 'agent', body: 'Done throughout.' }),
      )
      expect(answered.status).toBe('answered')
    }

    let review = await fixture.getJson<ReviewListing>('/api/review')
    expect(review.drafts[0]!.answeredNoteCount).toBe(1)
    expect(review.drafts[0]!.openNoteCount).toBe(0)
    expect(review.reviewNotes[0]!.status).toBe('answered')

    // The reviewer pushes back on one and accepts the other.
    await fixture.request(
      `/api/notes/${whole.id}/replies`,
      json('POST', { author: 'reviewer', body: 'Not what I meant.' }),
    )
    await fixture.request(`/api/notes/${everywhere.id}/resolve`, { method: 'POST' })

    review = await fixture.getJson<ReviewListing>('/api/review')
    expect(review.drafts[0]!.openNoteCount).toBe(1)
    expect(review.reviewNotes[0]!.status).toBe('resolved')

    const handoff = await fixture.getJson<Handoff>('/api/handoff')
    expect(handoff.openNoteCount).toBe(1)
    expect(handoff.answeredNoteCount).toBe(0)
  })

  it('refuses to re-attach a Note that was never about a passage', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const note = await draftNote(fixture, 'notes.md', 'Needs a summary section.')

    const response = await fixture.request(
      `/api/notes/${note.id}/reanchor`,
      json('POST', { from: 0, to: 5 }),
    )

    expect(response.status).toBe(400)
    expect((await readSidecar(fixture))!.notes[0]!.anchor).toBeUndefined()
  })
})

describe('what the agent is told', () => {
  it('tells the agent a Review Note applies to every Draft', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT, 'setup.md': OTHER })
    await reviewNote(fixture, 'Stop using em dashes anywhere.')

    const handoff = await fixture.getJson<Handoff>('/api/handoff')

    expect(handoff.openNoteCount).toBe(1)
    expect(handoff.instruction).toContain('1 Note is still open')
    expect(handoff.instruction).toContain('no `draftPath`')
    expect(handoff.instruction).toMatch(/every Draft in the folder/)
  })

  it('describes all three Scopes in the handoff, alongside the range Notes', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    await rangeNote(fixture, 'notes.md', DRAFT, 'three things', 'Which three?')
    await draftNote(fixture, 'notes.md', 'Needs a summary section.')
    await reviewNote(fixture, 'Stop using em dashes anywhere.')

    const { instruction } = await fixture.getJson<Handoff>('/api/handoff')

    expect(instruction).toContain('3 Notes are still open')
    // A passage, a whole Draft, and the whole folder.
    expect(instruction).toContain('anchor.text')
    expect(instruction).toContain('no `anchor`')
    expect(instruction).toContain('whole Draft')
    expect(instruction).toContain('whole Review')
    expect(instruction).toContain('`notes.md`')
  })

  it('explains in the sidecar README that a Review Note applies to every Draft', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    await reviewNote(fixture, 'Stop using em dashes anywhere.')

    const readme = (await fixture.read('.feedback/README.md'))!

    expect(readme).toContain('Apply it to *every* Draft here')
    expect(readme).toContain('no `draftPath`')
    expect(readme).toContain('How far a Note reaches')
    // The distinction the agent has to act on, spelled out.
    expect(readme).toContain('That whole Draft')
  })
})

describe('refusing a malformed Note', () => {
  const cases: { name: string; sent: unknown; status: number }[] = [
    { name: 'nothing to say', sent: { draftPath: 'notes.md' }, status: 400 },
    { name: 'an empty body', sent: { body: '   ' }, status: 400 },
    { name: 'half a range', sent: { draftPath: 'notes.md', from: 0, body: 'half' }, status: 400 },
    { name: 'a range that is not numbers', sent: { draftPath: 'notes.md', from: '0', to: '5', body: 'text' }, status: 400 },
    { name: 'a range with no Draft', sent: { from: 0, to: 5, body: 'where?' }, status: 400 },
    { name: 'a draftPath that is not a path', sent: { draftPath: 7, body: 'odd' }, status: 400 },
    { name: 'a Draft outside the Review', sent: { draftPath: '../leak.md', body: 'sneaky' }, status: 404 },
    { name: 'a Draft that is not there', sent: { draftPath: 'missing.md', body: 'nope' }, status: 404 },
  ]

  for (const { name, sent, status } of cases) {
    it(`refuses ${name}`, async () => {
      fixture = await createReviewFixture({ 'notes.md': DRAFT })

      const response = await fixture.request('/api/notes', json('POST', sent))

      expect(response.status).toBe(status)
      expect(await readSidecar(fixture)).toBeUndefined()
    })
  }
})

describe('Kinds at every Scope', () => {
  it('lets a Draft Note and a Review Note be Questions too', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const draftNote = await fixture.getJson<Note>(
      '/api/notes',
      json('POST', { draftPath: 'notes.md', body: 'Why is this structured this way?', kind: 'question' }),
    )
    const reviewNote = await fixture.getJson<Note>(
      '/api/notes',
      json('POST', { body: 'Should any of these files exist at all?', kind: 'question' }),
    )

    expect(draftNote.kind).toBe('question')
    expect(reviewNote.kind).toBe('question')

    // A Question is a Question wherever it is: the agent is told to answer it
    // rather than edit, and that must not depend on how far the Note reaches.
    const handoff = await fixture.getJson<Handoff>('/api/handoff')
    expect(handoff.instruction).toContain('2 are questions')
  })

  it('defaults a scoped Note to Fix when no Kind is given', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const note = await fixture.getJson<Note>(
      '/api/notes',
      json('POST', { body: 'Stop using em dashes anywhere.' }),
    )

    expect(note.kind).toBe('fix')
  })
})
