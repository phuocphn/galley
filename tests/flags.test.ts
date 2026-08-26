import { afterEach, describe, expect, it } from 'vitest'
import type {
  DraftContents,
  Flag,
  FlagSidecar,
  Handoff,
  ReviewListing,
  Sidecar,
} from '../src/shared/types.js'
import { createReviewFixture, type ReviewFixture } from './helpers/review-fixture.js'

const DRAFT = `# Release notes

Revenue grew 340% year on year, driven by the new segment.

As every practitioner knows, the third approach is the right one.
`

const OTHER = `# Method

See Figure 3 for the breakdown.
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

/** Raise a Flag on the first occurrence of some text. */
async function flag(
  live: ReviewFixture,
  draftPath: string,
  content: string,
  text: string,
  reason?: string,
): Promise<Flag> {
  const from = content.indexOf(text)
  expect(from, `"${text}" is not in the Draft`).toBeGreaterThanOrEqual(0)
  return await live.getJson<Flag>(
    '/api/flags',
    json('POST', { draftPath, from, to: from + text.length, reason }),
  )
}

describe('raising a Flag', () => {
  it('anchors to the text, and keeps the reason when one is given', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const raised = await flag(fixture, 'notes.md', DRAFT, 'Revenue grew 340%', 'verify')

    expect(raised.draftPath).toBe('notes.md')
    expect(raised.anchor.text).toBe('Revenue grew 340%')
    expect(raised.reason).toBe('verify')
    expect(raised.createdAt).toEqual(expect.any(String))
  })

  it('is one gesture — a Flag with no reason is a Flag', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const raised = await flag(fixture, 'notes.md', DRAFT, 'the third approach')

    expect(raised.anchor.text).toBe('the third approach')
    expect(raised).not.toHaveProperty('reason')
  })

  it('stores an all-whitespace reason as no reason at all', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const raised = await flag(fixture, 'notes.md', DRAFT, 'Revenue grew 340%', '   ')

    expect(raised).not.toHaveProperty('reason')
  })

  it('carries none of a Note’s apparatus — no Kind, Status or Replies', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const raised = await flag(fixture, 'notes.md', DRAFT, 'Revenue grew 340%')

    expect(Object.keys(raised).sort()).toEqual(['anchor', 'createdAt', 'draftPath', 'id'])
  })

  it('refuses a Flag with no passage to be about', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const noRange = await fixture.request('/api/flags', json('POST', { draftPath: 'notes.md' }))
    expect(noRange.status).toBe(400)

    const noDraft = await fixture.request('/api/flags', json('POST', { from: 0, to: 5 }))
    expect(noDraft.status).toBe(400)
  })

  it('refuses a range that is not in the Draft, and an unknown Draft', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const past = await fixture.request(
      '/api/flags',
      json('POST', { draftPath: 'notes.md', from: 0, to: DRAFT.length + 10 }),
    )
    expect(past.status).toBe(400)

    const missing = await fixture.request(
      '/api/flags',
      json('POST', { draftPath: 'nowhere.md', from: 0, to: 3 }),
    )
    expect(missing.status).toBe(404)
  })
})

describe('the agent contract', () => {
  it('writes Flags to their own file, and leaves notes.json alone', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    await flag(fixture, 'notes.md', DRAFT, 'Revenue grew 340%', 'verify')

    const flags = JSON.parse((await fixture.read('.feedback/flags.json'))!) as FlagSidecar
    expect(flags.version).toBe(1)
    expect(flags.flags).toHaveLength(1)

    // Not merely empty of Flags — a Flag never reaches this file at all.
    const notes = await fixture.read('.feedback/notes.json')
    if (notes !== undefined) {
      expect((JSON.parse(notes) as Sidecar).notes).toEqual([])
      expect(notes).not.toContain('verify')
    }
  })

  it('keeps Flags out of the handoff entirely', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    await flag(fixture, 'notes.md', DRAFT, 'Revenue grew 340%', 'verify this number')

    const handoff = await fixture.getJson<Handoff>('/api/handoff')

    expect(handoff.openNoteCount).toBe(0)
    expect(handoff.instruction).not.toContain('verify this number')
    expect(handoff.instruction).not.toContain('flags.json')
    expect(handoff.instruction).toContain('nothing to hand off')
  })

  it('tells the agent, in the folder README, to leave flags.json alone', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    await flag(fixture, 'notes.md', DRAFT, 'Revenue grew 340%')

    const readme = (await fixture.read('.feedback/README.md'))!
    expect(readme).toContain('flags.json')
    expect(readme).toContain('Not for you.')
  })
})

describe('locating a Flag', () => {
  it('carries the open Draft’s Flags, located in the text as it stands', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    await flag(fixture, 'notes.md', DRAFT, 'Revenue grew 340%', 'verify')

    const draft = await fixture.getJson<DraftContents>(draftUrl('notes.md'))

    expect(draft.flags).toHaveLength(1)
    expect(draft.flags[0]!.match).toBe('exact')
    expect(draft.flags[0]!.range).toEqual({
      from: DRAFT.indexOf('Revenue grew 340%'),
      to: DRAFT.indexOf('Revenue grew 340%') + 'Revenue grew 340%'.length,
    })
  })

  it('reports a Flag as Orphaned when the agent writes its passage away', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    await flag(fixture, 'notes.md', DRAFT, 'Revenue grew 340%', 'verify')

    await fixture.write('notes.md', '# Release notes\n\nNothing to report.\n')
    const draft = await fixture.getJson<DraftContents>(draftUrl('notes.md'))

    expect(draft.flags[0]!.match).toBe('orphaned')
    expect(draft.flags[0]!.range).toBeNull()
  })

  it('finds an Orphaned Flag again when the passage comes back — ADR-0007', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    await flag(fixture, 'notes.md', DRAFT, 'Revenue grew 340%', 'verify')

    await fixture.write('notes.md', '# Release notes\n\nNothing to report.\n')
    expect((await fixture.getJson<DraftContents>(draftUrl('notes.md'))).flags[0]!.match).toBe(
      'orphaned',
    )

    await fixture.write('notes.md', DRAFT)
    expect((await fixture.getJson<DraftContents>(draftUrl('notes.md'))).flags[0]!.match).toBe(
      'exact',
    )
  })

  it('shows a Draft only its own Flags', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT, 'method.md': OTHER })
    await flag(fixture, 'notes.md', DRAFT, 'Revenue grew 340%')
    await flag(fixture, 'method.md', OTHER, 'See Figure 3')

    const draft = await fixture.getJson<DraftContents>(draftUrl('method.md'))

    expect(draft.flags).toHaveLength(1)
    expect(draft.flags[0]!.anchor.text).toBe('See Figure 3')
  })

  it('does not write orphan state back into flags.json', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    await flag(fixture, 'notes.md', DRAFT, 'Revenue grew 340%')

    await fixture.write('notes.md', '# Release notes\n')
    await fixture.getJson<DraftContents>(draftUrl('notes.md'))

    const stored = JSON.parse((await fixture.read('.feedback/flags.json'))!) as FlagSidecar
    expect(stored.flags[0]!.anchor.orphaned).toBeUndefined()
  })
})

describe('the Review listing', () => {
  it('carries every Flag in the Review, stored rather than located', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT, 'method.md': OTHER })
    await flag(fixture, 'notes.md', DRAFT, 'Revenue grew 340%', 'verify')
    await flag(fixture, 'method.md', OTHER, 'See Figure 3')

    const listing = await fixture.getJson<ReviewListing>('/api/review')

    expect(listing.flags.map((one) => one.draftPath)).toEqual(['notes.md', 'method.md'])
    // Stored, not located — no range, no match. See `docs/adr/0010`.
    expect(listing.flags[0]).not.toHaveProperty('range')
    expect(listing.flags[0]).not.toHaveProperty('match')
  })

  it('leaves the Drafts’ Note counts untouched — a Flag is not the agent’s workload', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    await flag(fixture, 'notes.md', DRAFT, 'Revenue grew 340%')

    const listing = await fixture.getJson<ReviewListing>('/api/review')

    expect(listing.drafts[0]!.openNoteCount).toBe(0)
    expect(listing.drafts[0]!.answeredNoteCount).toBe(0)
  })
})

describe('changing and clearing a Flag', () => {
  it('writes down a reason after the fact', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const raised = await flag(fixture, 'notes.md', DRAFT, 'Revenue grew 340%')

    const updated = await fixture.getJson<Flag>(
      `/api/flags/${raised.id}`,
      json('PATCH', { reason: 'is this annualised?' }),
    )

    expect(updated.reason).toBe('is this annualised?')
    expect(updated.anchor).toEqual(raised.anchor)
  })

  it('drops the reason entirely when it is cleared', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const raised = await flag(fixture, 'notes.md', DRAFT, 'Revenue grew 340%', 'verify')

    const updated = await fixture.getJson<Flag>(
      `/api/flags/${raised.id}`,
      json('PATCH', { reason: '  ' }),
    )

    expect(updated).not.toHaveProperty('reason')
  })

  it('clearing removes it from the file — there is no cleared state', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const raised = await flag(fixture, 'notes.md', DRAFT, 'Revenue grew 340%', 'verify')

    const response = await fixture.request(`/api/flags/${raised.id}`, { method: 'DELETE' })
    expect(response.status).toBe(204)

    const stored = JSON.parse((await fixture.read('.feedback/flags.json'))!) as FlagSidecar
    expect(stored.flags).toEqual([])
    expect((await fixture.getJson<ReviewListing>('/api/review')).flags).toEqual([])
  })

  it('answers 404 for a Flag that is not there', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    expect((await fixture.request('/api/flags/nope', { method: 'DELETE' })).status).toBe(404)
    expect(
      (await fixture.request('/api/flags/nope', json('PATCH', { reason: 'x' }))).status,
    ).toBe(404)
  })

  it('leaves other Flags alone when one is cleared', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const first = await flag(fixture, 'notes.md', DRAFT, 'Revenue grew 340%')
    const second = await flag(fixture, 'notes.md', DRAFT, 'the third approach')

    await fixture.request(`/api/flags/${first.id}`, { method: 'DELETE' })

    const listing = await fixture.getJson<ReviewListing>('/api/review')
    expect(listing.flags.map((one) => one.id)).toEqual([second.id])
  })
})

describe('promoting a Flag to a Note', () => {
  it('the Note lands on the same passage, and the Flag is gone', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const raised = await flag(fixture, 'notes.md', DRAFT, 'Revenue grew 340%', 'verify')

    // The client writes the Note first, then clears the Flag: a crash between
    // the two leaves a stray Flag rather than a lost Note. See `docs/adr/0010`.
    const from = DRAFT.indexOf('Revenue grew 340%')
    await fixture.getJson('/api/notes', json('POST', {
      draftPath: 'notes.md',
      from,
      to: from + 'Revenue grew 340%'.length,
      body: 'verify this number against the filing',
      kind: 'question',
    }))
    await fixture.request(`/api/flags/${raised.id}`, { method: 'DELETE' })

    const draft = await fixture.getJson<DraftContents>(draftUrl('notes.md'))
    expect(draft.flags).toEqual([])
    expect(draft.notes).toHaveLength(1)
    expect(draft.notes[0]!.anchor!.text).toBe('Revenue grew 340%')
    expect(draft.notes[0]!.kind).toBe('question')

    // And now, unlike the Flag, it reaches the agent.
    const handoff = await fixture.getJson<Handoff>('/api/handoff')
    expect(handoff.openNoteCount).toBe(1)
  })
})
