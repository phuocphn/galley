import { afterEach, describe, expect, it } from 'vitest'
import type {
  DraftContents,
  NewNote,
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

let fixture: ReviewFixture | undefined

afterEach(async () => {
  await fixture?.cleanup()
  fixture = undefined
})

const draftUrl = (draftPath: string) => `/api/draft?${new URLSearchParams({ path: draftPath })}`

function jsonBody(value: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  }
}

/** Attach a Note to the first occurrence of `phrase` in the Draft. */
async function noteOn(
  review: ReviewFixture,
  draftPath: string,
  content: string,
  phrase: string,
  body: string,
): Promise<Note> {
  const from = content.indexOf(phrase)
  expect(from, `"${phrase}" is not in the fixture Draft`).toBeGreaterThanOrEqual(0)

  const submission: NewNote = { draftPath, from, to: from + phrase.length, body }
  return review.getJson<Note>('/api/notes', jsonBody(submission))
}

async function readSidecar(review: ReviewFixture): Promise<Sidecar | undefined> {
  const raw = await review.read('.feedback/notes.json')
  return raw ? (JSON.parse(raw) as Sidecar) : undefined
}

describe('attaching a Note', () => {
  it('anchors the Note to the text, not to the line it happened to be on', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const note = await noteOn(fixture, 'notes.md', DRAFT, 'three things', 'Which three?')

    expect(note.anchor.text).toBe('three things')
    expect(note.anchor.before).toContain('We shipped ')
    expect(note.anchor.after).toContain(' this week')
    expect(note.anchor.startLine).toBe(3)
    expect(note.anchor.endLine).toBe(3)
  })

  it('records the Note as open, on its Draft, with timestamps', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const note = await noteOn(fixture, 'notes.md', DRAFT, 'three things', 'Which three?')

    expect(note.draftPath).toBe('notes.md')
    expect(note.status).toBe('open')
    expect(note.body).toBe('Which three?')
    expect(note.id).not.toBe('')
    expect(Date.parse(note.createdAt)).not.toBeNaN()
    expect(note.updatedAt).toBe(note.createdAt)
  })

  it('keeps the Markdown body verbatim, trimmed', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const note = await noteOn(
      fixture,
      'notes.md',
      DRAFT,
      'three things',
      '  Name them:\n\n- one\n- two\n\nUse `code` where it helps.  ',
    )

    expect(note.body).toBe('Name them:\n\n- one\n- two\n\nUse `code` where it helps.')
  })

  it('spans a multi-line range', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const note = await noteOn(
      fixture,
      'notes.md',
      DRAFT,
      '## Details\n\nNothing further to report.',
      'This section is filler. Cut it or fill it in.',
    )

    expect(note.anchor.startLine).toBe(5)
    expect(note.anchor.endLine).toBe(7)
  })

  it('writes the sidecar and its README into .feedback/', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    await noteOn(fixture, 'notes.md', DRAFT, 'three things', 'Which three?')

    const sidecar = await readSidecar(fixture)
    expect(sidecar?.version).toBe(1)
    expect(sidecar?.notes).toHaveLength(1)

    const readme = await fixture.read('.feedback/README.md')
    expect(readme).toContain('anchor.text')
    expect(readme).toContain('Never rewrite `notes.json` wholesale')
  })

  it('keys Notes by Draft path so one sidecar covers the whole Review', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT, 'guides/setup.md': DRAFT })

    await noteOn(fixture, 'notes.md', DRAFT, 'three things', 'Which three?')
    await noteOn(fixture, 'guides/setup.md', DRAFT, 'Nothing further', 'Say something.')

    const sidecar = await readSidecar(fixture)
    expect(sidecar?.notes.map((note) => note.draftPath)).toEqual(['notes.md', 'guides/setup.md'])
  })

  it('refuses a Note with nothing to say', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const response = await fixture.request(
      '/api/notes',
      jsonBody({ draftPath: 'notes.md', from: 0, to: 5, body: '   ' }),
    )

    expect(response.status).toBe(400)
    expect(await readSidecar(fixture)).toBeUndefined()
  })

  it('refuses a Note on a Draft that is not in the Review', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const response = await fixture.request(
      '/api/notes',
      jsonBody({ draftPath: '../leak.md', from: 0, to: 5, body: 'sneaky' }),
    )

    expect(response.status).toBe(404)
  })

  it('refuses a range that is not in the Draft', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const response = await fixture.request(
      '/api/notes',
      jsonBody({ draftPath: 'notes.md', from: 0, to: DRAFT.length + 50, body: 'off the end' }),
    )

    expect(response.status).toBe(400)
  })
})

describe('reading Notes back', () => {
  it('returns each Note located in the Draft as it stands', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    await noteOn(fixture, 'notes.md', DRAFT, 'three things', 'Which three?')

    const draft = await fixture.getJson<DraftContents>(draftUrl('notes.md'))

    expect(draft.notes).toHaveLength(1)
    const [note] = draft.notes
    expect(note!.range).not.toBeNull()
    expect(draft.content.slice(note!.range!.from, note!.range!.to)).toBe('three things')
  })

  it('returns only the Notes belonging to that Draft', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT, 'guides/setup.md': DRAFT })
    await noteOn(fixture, 'notes.md', DRAFT, 'three things', 'Which three?')
    await noteOn(fixture, 'guides/setup.md', DRAFT, 'three things', 'Same question.')

    const draft = await fixture.getJson<DraftContents>(draftUrl('notes.md'))

    expect(draft.notes).toHaveLength(1)
    expect(draft.notes[0]!.body).toBe('Which three?')
  })

  it('counts each Draft’s open Notes in the Review listing', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT, 'guides/setup.md': DRAFT })
    await noteOn(fixture, 'notes.md', DRAFT, 'three things', 'Which three?')
    await noteOn(fixture, 'notes.md', DRAFT, 'Nothing further', 'Say something.')

    const review = await fixture.getJson<ReviewListing>('/api/review')

    const counts = Object.fromEntries(
      review.drafts.map((draft) => [draft.path, draft.openNoteCount]),
    )
    expect(counts).toEqual({ 'notes.md': 2, 'guides/setup.md': 0 })
  })
})

describe('re-finding a Note after the Draft changes', () => {
  it('follows its text when the passage moves down the Draft', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    await noteOn(fixture, 'notes.md', DRAFT, 'three things', 'Which three?')

    // An agent prepends a section, pushing every line down.
    const rewritten = `# Preamble\n\nSome new opening material.\n\n${DRAFT}`
    await fixture.write('notes.md', rewritten)

    const draft = await fixture.getJson<DraftContents>(draftUrl('notes.md'))

    const [note] = draft.notes
    expect(note!.range).not.toBeNull()
    expect(draft.content.slice(note!.range!.from, note!.range!.to)).toBe('three things')
    // The stored line hint is now stale, which is exactly why it isn't used.
    expect(note!.anchor.startLine).toBe(3)
    expect(note!.range!.from).toBeGreaterThan(rewritten.indexOf('# Release notes'))
  })

  it('picks the occurrence whose surroundings still match when the text repeats', async () => {
    const repeated = 'Intro says the thing.\n\nBody says the thing.\n'
    fixture = await createReviewFixture({ 'notes.md': repeated })
    await noteOn(fixture, 'notes.md', repeated, 'says the thing', 'Vague.')

    // Both occurrences survive; only the context tells them apart.
    const rewritten = `Preface.\n\n${repeated}`
    await fixture.write('notes.md', rewritten)

    const draft = await fixture.getJson<DraftContents>(draftUrl('notes.md'))

    const [note] = draft.notes
    expect(draft.content.slice(0, note!.range!.from)).toMatch(/Intro $/)
  })

  it('reports no range when the passage is gone', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    await noteOn(fixture, 'notes.md', DRAFT, 'three things', 'Which three?')

    await fixture.write('notes.md', '# Release notes\n\nCompletely rewritten.\n')

    const draft = await fixture.getJson<DraftContents>(draftUrl('notes.md'))

    expect(draft.notes[0]!.range).toBeNull()
  })
})

describe('changing a Note', () => {
  it('edits the body and moves updatedAt on', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const note = await noteOn(fixture, 'notes.md', DRAFT, 'three things', 'Which three?')

    const edited = await fixture.getJson<Note>(`/api/notes/${note.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Name all three, with links.' }),
    })

    expect(edited.body).toBe('Name all three, with links.')
    expect(edited.anchor).toEqual(note.anchor)
    expect(Date.parse(edited.updatedAt)).toBeGreaterThanOrEqual(Date.parse(note.createdAt))

    const sidecar = await readSidecar(fixture)
    expect(sidecar?.notes[0]!.body).toBe('Name all three, with links.')
  })

  it('deletes a Note, leaving the others alone', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const doomed = await noteOn(fixture, 'notes.md', DRAFT, 'three things', 'Which three?')
    const kept = await noteOn(fixture, 'notes.md', DRAFT, 'Nothing further', 'Say something.')

    const response = await fixture.request(`/api/notes/${doomed.id}`, { method: 'DELETE' })
    expect(response.status).toBe(204)

    const sidecar = await readSidecar(fixture)
    expect(sidecar?.notes.map((note) => note.id)).toEqual([kept.id])
  })

  it('404s when editing or deleting a Note that is not there', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })

    const patched = await fixture.request('/api/notes/nope', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'hello' }),
    })
    const deleted = await fixture.request('/api/notes/nope', { method: 'DELETE' })

    expect([patched.status, deleted.status]).toEqual([404, 404])
  })

  it('leaves a Note the agent added in the meantime alone', async () => {
    fixture = await createReviewFixture({ 'notes.md': DRAFT })
    const mine = await noteOn(fixture, 'notes.md', DRAFT, 'three things', 'Which three?')

    // An agent writes straight into the sidecar between the reviewer's actions.
    const sidecar = (await readSidecar(fixture))!
    const theirs: Note = {
      ...mine,
      id: 'agent-added',
      body: 'Added by something else entirely.',
    }
    await fixture.write('.feedback/notes.json', JSON.stringify({ ...sidecar, notes: [...sidecar.notes, theirs] }))

    await noteOn(fixture, 'notes.md', DRAFT, 'Nothing further', 'Say something.')

    const after = await readSidecar(fixture)
    expect(after?.notes.map((note) => note.id)).toContain('agent-added')
    expect(after?.notes).toHaveLength(3)
  })
})
