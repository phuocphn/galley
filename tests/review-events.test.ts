import { afterEach, describe, expect, it } from 'vitest'
import type { DraftContents, Note, Sidecar } from '../src/shared/types.js'
import { startLiveReview, type LiveReview } from './helpers/live-review.js'

const DRAFT = `# Release notes

We shipped three things this week.
`

let review: LiveReview | undefined

afterEach(async () => {
  await review?.close()
  review = undefined
})

async function postJson<T>(url: string, value: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  })
  if (!response.ok) throw new Error(`${url} responded ${response.status}`)
  return (await response.json()) as T
}

describe('watching the Review', () => {
  it('announces a Draft an agent rewrote', async () => {
    review = await startLiveReview({ 'notes.md': DRAFT })

    await review.write('notes.md', `${DRAFT}\nAn agent added this.\n`)

    const event = await review.nextEvent(
      (candidate) => candidate.type === 'draft-changed' && candidate.path === 'notes.md',
    )
    expect(event).toEqual({ type: 'draft-changed', path: 'notes.md' })
  })

  it('announces a Draft in a nested folder', async () => {
    review = await startLiveReview({ 'guides/setup.md': DRAFT })

    await review.write('guides/setup.md', `${DRAFT}\nRewritten.\n`)

    const event = await review.nextEvent((candidate) => candidate.type === 'draft-changed')
    expect(event).toEqual({ type: 'draft-changed', path: 'guides/setup.md' })
  })

  it('announces a Reply an agent wrote straight into the sidecar', async () => {
    review = await startLiveReview({ 'notes.md': DRAFT })
    const from = DRAFT.indexOf('three things')
    const note = await postJson<Note>(`${review.url}/api/notes`, {
      draftPath: 'notes.md',
      from,
      to: from + 'three things'.length,
      body: 'Which three?',
    })

    // Wait out the notes-changed the editor's own write causes.
    await review.nextEvent((candidate) => candidate.type === 'notes-changed')

    const raw = await fetch(`${review.url}/api/draft?path=notes.md`)
    const draft = (await raw.json()) as DraftContents
    expect(draft.notes).toHaveLength(1)

    const sidecar: Sidecar = {
      version: 1,
      notes: [
        {
          ...note,
          status: 'answered',
          replies: [
            {
              id: 'reply-1',
              author: 'agent',
              body: 'Named all three.',
              createdAt: new Date().toISOString(),
            },
          ],
        },
      ],
    }
    await review.write('.feedback/notes.json', JSON.stringify(sidecar, null, 2))

    const event = await review.nextEvent((candidate) => candidate.type === 'notes-changed')
    expect(event).toEqual({ type: 'notes-changed' })

    const after = (await (await fetch(`${review.url}/api/draft?path=notes.md`)).json()) as DraftContents
    expect(after.notes[0]!.status).toBe('answered')
    expect(after.notes[0]!.replies[0]!.body).toBe('Named all three.')
  })

  it('stays quiet about files that are not part of the Review', async () => {
    review = await startLiveReview({ 'notes.md': DRAFT })

    await review.write('build.log', 'noise')
    await review.write('data.json', '{}')
    await review.write('notes.md', `${DRAFT}\nReal change.\n`)

    // The Draft change is the only thing that should come through, and it should
    // be the first event — nothing before it.
    const event = await review.nextEvent(() => true)
    expect(event).toEqual({ type: 'draft-changed', path: 'notes.md' })
  })
})
