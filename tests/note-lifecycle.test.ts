import { afterEach, describe, expect, it } from 'vitest'
import type { Handoff, Note, NoteKind, ReviewListing, Sidecar } from '../src/shared/types.js'
import { createReviewFixture, type ReviewFixture } from './helpers/review-fixture.js'

const DRAFT = `# Release notes

We shipped three things this week, and they are all great.
`

let fixture: ReviewFixture | undefined

afterEach(async () => {
  await fixture?.cleanup()
  fixture = undefined
})

function json(method: string, value: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }
}

async function noteOn(
  review: ReviewFixture,
  phrase: string,
  body: string,
  kind?: NoteKind,
): Promise<Note> {
  const from = DRAFT.indexOf(phrase)
  return review.getJson<Note>(
    '/api/notes',
    json('POST', { draftPath: 'notes.md', from, to: from + phrase.length, body, kind }),
  )
}

const reply = (author: 'agent' | 'reviewer', body: string): RequestInit =>
  json('POST', { author, body })

async function readSidecar(review: ReviewFixture): Promise<Sidecar> {
  return JSON.parse((await review.read('.feedback/notes.json'))!) as Sidecar
}

describe('the Note lifecycle', () => {
  it('walks open → answered → resolved', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const note = await noteOn(fixture, 'three things', 'Which three?')
    expect(note.status).toBe('open')

    const answered = await fixture.getJson<Note>(
      `/api/notes/${note.id}/replies`,
      reply('agent', 'Named all three.'),
    )
    expect(answered.status).toBe('answered')
    expect(answered.replies).toHaveLength(1)
    expect(answered.replies[0]!.author).toBe('agent')

    const resolved = await fixture.getJson<Note>(`/api/notes/${note.id}/resolve`, {
      method: 'POST',
    })
    expect(resolved.status).toBe('resolved')

    expect((await readSidecar(fixture)).notes[0]!.status).toBe('resolved')
  })

  it('reopens an answered Note when the reviewer replies again', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const note = await noteOn(fixture, 'three things', 'Which three?')
    await fixture.request(`/api/notes/${note.id}/replies`, reply('agent', 'Done.'))

    const reopened = await fixture.getJson<Note>(
      `/api/notes/${note.id}/replies`,
      reply('reviewer', "That's not what I meant."),
    )

    expect(reopened.status).toBe('open')
    expect(reopened.replies.map((entry) => entry.author)).toEqual(['agent', 'reviewer'])
  })

  it('shows a Note as answered even if the agent forgot to set the status', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const note = await noteOn(fixture, 'three things', 'Which three?')

    // An agent appends a Reply straight into the sidecar and leaves `status` alone.
    const sidecar = await readSidecar(fixture)
    sidecar.notes[0]!.replies.push({
      id: 'reply-1',
      author: 'agent',
      body: 'Rewrote the sentence.',
      createdAt: new Date().toISOString(),
    })
    await fixture.write('.feedback/notes.json', JSON.stringify(sidecar))

    const review = await fixture.getJson<ReviewListing>('/api/review')

    expect(review.drafts[0]!.openNoteCount).toBe(0)
    expect(review.drafts[0]!.answeredNoteCount).toBe(1)
    expect(note.status).toBe('open')
  })

  it('never deletes a Resolved Note', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const note = await noteOn(fixture, 'three things', 'Which three?')
    await fixture.request(`/api/notes/${note.id}/resolve`, { method: 'POST' })

    const sidecar = await readSidecar(fixture)
    expect(sidecar.notes).toHaveLength(1)
    expect(sidecar.notes[0]!.body).toBe('Which three?')
  })

  it('leaves a Resolved Note out of the Draft’s counts', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const kept = await noteOn(fixture, 'three things', 'Which three?')
    const done = await noteOn(fixture, 'Release notes', 'Capitalise this.')
    await fixture.request(`/api/notes/${done.id}/resolve`, { method: 'POST' })

    const review = await fixture.getJson<ReviewListing>('/api/review')

    expect(review.drafts[0]!.openNoteCount).toBe(1)
    expect(review.drafts[0]!.answeredNoteCount).toBe(0)
    expect(kept.status).toBe('open')
  })

  it('refuses an empty Reply and 404s on a Note that is not there', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const note = await noteOn(fixture, 'three things', 'Which three?')

    const empty = await fixture.request(
      `/api/notes/${note.id}/replies`,
      reply('reviewer', '   '),
    )
    const missing = await fixture.request('/api/notes/nope/replies', reply('agent', 'hi'))
    const unresolvable = await fixture.request('/api/notes/nope/resolve', { method: 'POST' })

    expect([empty.status, missing.status, unresolvable.status]).toEqual([400, 404, 404])
  })
})

describe('the handoff instruction', () => {
  it('stands on its own: where the sidecar is, what is outstanding, how to reply', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    await noteOn(fixture, 'three things', 'Which three?')

    const handoff = await fixture.getJson<Handoff>('/api/handoff')

    expect(handoff.openNoteCount).toBe(1)
    expect(handoff.instruction).toContain('.feedback/notes.json')
    expect(handoff.instruction).toContain('1 Note still open')
    expect(handoff.instruction).toContain('anchor.text')
    expect(handoff.instruction).toContain('"author": "agent"')
    expect(handoff.instruction).toContain('answered')
    expect(handoff.instruction).toContain('notes.md')
    expect(handoff.instruction).toContain('`kind`')
    expect(handoff.instruction).toContain('1 asks for a fix')
  })

  it('says what each Kind present is asking for, before the mechanics', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    await noteOn(fixture, 'three things', 'Name them.', 'fix')
    await noteOn(fixture, 'this week', 'Was this the same week as the outage?', 'question')
    await noteOn(fixture, 'Release notes', 'A subtitle might help.', 'idea')

    const handoff = await fixture.getJson<Handoff>('/api/handoff')

    expect(handoff.instruction).toContain('1 asks for a fix, 1 is a question, and 1 is an idea')
    expect(handoff.instruction).toContain('`fix` — change the anchored text')
    expect(handoff.instruction).toContain('`idea` — a suggestion, not an instruction')

    // The whole point of a Question: an answer, not an edit — and said before
    // the step-by-step, so an agent that skims the top still sees it.
    expect(handoff.instruction).toContain(
      '`question` — the reviewer is asking you something. Answer it in a Reply and leave the Draft alone. Do not edit anything for a Question.',
    )
    expect(handoff.instruction.indexOf('`question` —')).toBeLessThan(
      handoff.instruction.indexOf('How to work through it:'),
    )
  })

  it('explains only the Kinds that are actually present', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    await noteOn(fixture, 'three things', 'Name them.')
    await noteOn(fixture, 'Release notes', 'Capitalise this.')

    const handoff = await fixture.getJson<Handoff>('/api/handoff')

    expect(handoff.instruction).toContain('2 ask for a fix')
    expect(handoff.instruction).not.toContain('`question`')
    expect(handoff.instruction).not.toContain('`idea`')
  })

  it('leaves a Resolved Note out of the Kind tally', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    await noteOn(fixture, 'three things', 'Name them.', 'question')
    const done = await noteOn(fixture, 'Release notes', 'Capitalise this.', 'idea')
    await fixture.request(`/api/notes/${done.id}/resolve`, { method: 'POST' })

    const handoff = await fixture.getJson<Handoff>('/api/handoff')

    expect(handoff.instruction).toContain('Of those, 1 is a question.')
    expect(handoff.instruction).not.toContain('`idea`')
  })

  it('tells the agent the Drafts may have been hand-edited', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    await noteOn(fixture, 'three things', 'Which three?')

    const handoff = await fixture.getJson<Handoff>('/api/handoff')

    expect(handoff.instruction).toMatch(/edited these Drafts by hand/)
    expect(handoff.instruction).toMatch(/current\n?content as intentional/)
  })

  it('tells the agent not to resolve Notes itself', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    await noteOn(fixture, 'three things', 'Which three?')

    const handoff = await fixture.getJson<Handoff>('/api/handoff')

    expect(handoff.instruction).toMatch(/Do not set .?"?resolved/)
  })

  it('counts answered Notes separately from open ones', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const answered = await noteOn(fixture, 'three things', 'Which three?')
    await noteOn(fixture, 'Release notes', 'Capitalise this.')
    await fixture.request(`/api/notes/${answered.id}/replies`, reply('agent', 'Done.'))

    const handoff = await fixture.getJson<Handoff>('/api/handoff')

    expect(handoff.openNoteCount).toBe(1)
    expect(handoff.answeredNoteCount).toBe(1)
    expect(handoff.instruction).toContain('1 Note already answered but not yet accepted')
  })

  it('says there is nothing to do when every Note is resolved', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const note = await noteOn(fixture, 'three things', 'Which three?')
    await fixture.request(`/api/notes/${note.id}/resolve`, { method: 'POST' })

    const handoff = await fixture.getJson<Handoff>('/api/handoff')

    expect(handoff.openNoteCount).toBe(0)
    expect(handoff.instruction).toContain('no outstanding review feedback')
    expect(handoff.instruction).toContain('Every one of its 1 Note is resolved')
  })

  it('does not claim Notes are resolved when none were ever left', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const handoff = await fixture.getJson<Handoff>('/api/handoff')

    expect(handoff.openNoteCount).toBe(0)
    expect(handoff.instruction).toContain('No Notes have been left')
    expect(handoff.instruction).not.toContain('resolved')
  })
})
