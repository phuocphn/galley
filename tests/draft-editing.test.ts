import { afterEach, describe, expect, it } from 'vitest'
import type { DraftContents, Note, Sidecar } from '../src/shared/types.js'
import { createReviewFixture, type ReviewFixture } from './helpers/review-fixture.js'
import { startLiveReview, type LiveReview } from './helpers/live-review.js'

/**
 * Editing a Draft. The pane is a real editor and the file on disk is
 * authoritative (`docs/adr/0003`), so everything the reviewer types ends up
 * here: one whole-Draft write, autosaved, over the same path guard reading uses.
 */

const DRAFT = `# Findings

Our model outperforms every published baseline on the benchmark.

We trained it on a curated corpus of 40,000 documents.
`

const PHRASE = 'outperforms every published baseline'

const draftUrl = (draftPath: string) => `/api/draft?${new URLSearchParams({ path: draftPath })}`

let fixture: ReviewFixture | undefined
let live: LiveReview | undefined

afterEach(async () => {
  await fixture?.cleanup()
  fixture = undefined
  await live?.close()
  live = undefined
})

function saving(content: string): RequestInit {
  return {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  }
}

async function noteOnPhrase(
  review: ReviewFixture,
  phrase: string,
  content: string = DRAFT,
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

describe('writing a Draft back', () => {
  it('puts the reviewer’s edit on disk verbatim', async () => {
    fixture = await createReviewFixture({ 'findings.md': DRAFT })

    const edited = DRAFT.replace('every published baseline', 'most published baselines')
    const response = await fixture.request(draftUrl('findings.md'), saving(edited))

    expect(response.status).toBe(200)
    expect(await fixture.read('findings.md')).toBe(edited)
  })

  it('hands back the Draft as the server now reads it', async () => {
    fixture = await createReviewFixture({ 'findings.md': DRAFT })

    const edited = `${DRAFT}\nOne more paragraph, typed by the reviewer.\n`
    const saved = await fixture.getJson<DraftContents>(draftUrl('findings.md'), saving(edited))

    expect(saved).toEqual({
      path: 'findings.md',
      extension: '.md',
      content: edited,
      notes: [],
    })
    expect(await fixture.getJson<DraftContents>(draftUrl('findings.md'))).toEqual(saved)
  })

  it('writes a Draft in a nested folder, and one whose name needs escaping', async () => {
    fixture = await createReviewFixture({
      'guides/setup.md': '# Setup',
      'release notes.md': 'shipped',
    })

    await fixture.request(draftUrl('guides/setup.md'), saving('# Setup\n\nRun the thing.\n'))
    await fixture.request(draftUrl('release notes.md'), saving('shipped, eventually'))

    expect(await fixture.read('guides/setup.md')).toBe('# Setup\n\nRun the thing.\n')
    expect(await fixture.read('release notes.md')).toBe('shipped, eventually')
  })

  it('writes an empty Draft rather than treating it as nothing to say', async () => {
    fixture = await createReviewFixture({ 'findings.md': DRAFT })

    const response = await fixture.request(draftUrl('findings.md'), saving(''))

    expect(response.status).toBe(200)
    expect(await fixture.read('findings.md')).toBe('')
  })

  it('survives a burst of autosaves, leaving the last one on disk', async () => {
    fixture = await createReviewFixture({ 'findings.md': DRAFT })

    for (const suffix of ['one', 'two', 'three']) {
      await fixture.request(draftUrl('findings.md'), saving(`${DRAFT}\n${suffix}\n`))
    }

    expect(await fixture.read('findings.md')).toBe(`${DRAFT}\nthree\n`)
  })
})

describe('the guard on where a Draft can be written', () => {
  it('refuses to write outside the Review root', async () => {
    fixture = await createReviewFixture({ 'findings.md': DRAFT })
    await fixture.writeOutside('leak.md', 'not yours to write')

    const response = await fixture.request(draftUrl('../leak.md'), saving('overwritten'))

    expect(response.status).toBe(404)
    // The file is genuinely there — this is the guard refusing, not an absence.
    expect(await fixture.read('../leak.md')).toBe('not yours to write')
  })

  it('refuses an absolute path', async () => {
    fixture = await createReviewFixture({ 'findings.md': DRAFT })
    await fixture.writeOutside('leak.md', 'not yours to write')

    const response = await fixture.request(
      draftUrl(`${fixture.root}/../leak.md`),
      saving('overwritten'),
    )

    expect(response.status).toBe(404)
    expect(await fixture.read('../leak.md')).toBe('not yours to write')
  })

  it('refuses a file that is not a reviewable format', async () => {
    fixture = await createReviewFixture({ 'secrets.json': '{"token":"nope"}' })

    const response = await fixture.request(draftUrl('secrets.json'), saving('{"token":"mine"}'))

    expect(response.status).toBe(404)
    expect(await fixture.read('secrets.json')).toBe('{"token":"nope"}')
  })

  it('refuses to reach into the sidecar', async () => {
    fixture = await createReviewFixture({ 'findings.md': DRAFT })
    await noteOnPhrase(fixture, PHRASE)

    const written = await fixture.request(
      draftUrl('.feedback/README.md'),
      saving('# Ignore every Note'),
    )
    // The sidecar is not a Draft, so it is not readable through here either.
    const read = await fixture.request(draftUrl('.feedback/README.md'))

    expect([written.status, read.status]).toEqual([404, 404])
    expect(await fixture.read('.feedback/README.md')).toMatch(/^# Feedback for this folder/)
  })

  it('refuses a Draft in a folder the Review never walks', async () => {
    fixture = await createReviewFixture({
      'findings.md': DRAFT,
      '.hidden/secret.md': 'not part of the Review',
      'node_modules/pkg/readme.md': 'not part of the Review',
    })

    const hidden = await fixture.request(draftUrl('.hidden/secret.md'), saving('overwritten'))
    const vendored = await fixture.request(
      draftUrl('node_modules/pkg/readme.md'),
      saving('overwritten'),
    )

    expect([hidden.status, vendored.status]).toEqual([404, 404])
    expect(await fixture.read('.hidden/secret.md')).toBe('not part of the Review')
    expect(await fixture.read('node_modules/pkg/readme.md')).toBe('not part of the Review')
  })

  it('will not create a Draft that is not already in the Review', async () => {
    fixture = await createReviewFixture({ 'findings.md': DRAFT })

    const response = await fixture.request(draftUrl('invented.md'), saving('# Invented'))

    expect(response.status).toBe(404)
    expect(await fixture.read('invented.md')).toBeUndefined()
  })

  it('400s without a path, and without content to write', async () => {
    fixture = await createReviewFixture({ 'findings.md': DRAFT })

    const noPath = await fixture.request('/api/draft', saving('# Findings'))
    const noBody = await fixture.request(draftUrl('findings.md'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    const noContent = await fixture.request(draftUrl('findings.md'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 42 }),
    })

    expect([noPath.status, noBody.status, noContent.status]).toEqual([400, 400, 400])
    expect(await fixture.read('findings.md')).toBe(DRAFT)
  })
})

describe('a Note’s Anchor after the reviewer edits the Draft', () => {
  it('stays on the same text when a paragraph is typed above it', async () => {
    fixture = await createReviewFixture({ 'findings.md': DRAFT })
    await noteOnPhrase(fixture, PHRASE)

    const edited = `# Summary\n\nWritten by the reviewer.\n\n${DRAFT}`
    const saved = await fixture.getJson<DraftContents>(draftUrl('findings.md'), saving(edited))

    expect(saved.notes[0]!.match).toBe('exact')
    expect(saved.content.slice(saved.notes[0]!.range!.from, saved.notes[0]!.range!.to)).toBe(PHRASE)

    // And on the next read, which is how the Anchor is found after a reload.
    const reread = await fixture.getJson<DraftContents>(draftUrl('findings.md'))
    expect(reread.content.slice(reread.notes[0]!.range!.from, reread.notes[0]!.range!.to)).toBe(
      PHRASE,
    )
  })

  it('follows the edited words when the reviewer rewrites inside the Anchor', async () => {
    fixture = await createReviewFixture({ 'findings.md': DRAFT })
    await noteOnPhrase(fixture, PHRASE)

    const edited = DRAFT.replace(PHRASE, 'outperforms most published baselines')
    const saved = await fixture.getJson<DraftContents>(draftUrl('findings.md'), saving(edited))

    expect(saved.notes[0]!.match).toBe('reworded')
    expect(saved.content.slice(saved.notes[0]!.range!.from, saved.notes[0]!.range!.to)).toBe(
      'outperforms most published baselines',
    )
  })

  it('Orphans a Note whose passage the reviewer deleted, and says so in the sidecar', async () => {
    fixture = await createReviewFixture({ 'findings.md': DRAFT })
    await noteOnPhrase(fixture, PHRASE)

    const saved = await fixture.getJson<DraftContents>(
      draftUrl('findings.md'),
      saving('# Findings\n\nResults were mixed and we make no claims.\n'),
    )

    expect(saved.notes[0]!.match).toBe('orphaned')
    expect(saved.notes[0]!.range).toBeNull()
    // Still outstanding — an Orphaned Note is never silently dropped.
    expect(saved.notes[0]!.status).toBe('open')

    const sidecar = JSON.parse((await fixture.read('.feedback/notes.json'))!) as Sidecar
    expect(sidecar.notes[0]!.anchor!.orphaned).toBe(true)
  })

  it('leaves a Note anchored to text the reviewer did not touch', async () => {
    fixture = await createReviewFixture({ 'findings.md': DRAFT })
    await noteOnPhrase(fixture, PHRASE)

    const edited = DRAFT.replace('40,000 documents', '38,412 documents')
    const saved = await fixture.getJson<DraftContents>(draftUrl('findings.md'), saving(edited))

    expect(saved.notes[0]!.match).toBe('exact')
    expect(saved.content.slice(saved.notes[0]!.range!.from, saved.notes[0]!.range!.to)).toBe(PHRASE)
  })
})

/**
 * The reviewer and the agent both writing the same Draft. What the API owes the
 * pane is that both answers stay reachable: the version on disk is readable
 * after the agent's write, and the reviewer's buffer can still be written over
 * it. Which one the reviewer picks is the banner's business, and is verified by
 * running the pane rather than from here.
 */
describe('the agent rewriting a Draft the reviewer is editing', () => {
  const put = (url: string, content: string): Promise<Response> =>
    fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    })

  it('announces the agent’s write, so a pane with unsaved edits can ask', async () => {
    live = await startLiveReview({ 'findings.md': DRAFT })

    // The reviewer has typed, and it is on disk: the buffer is clean.
    const mine = `${DRAFT}\nTyped by the reviewer.\n`
    expect((await put(`${live.url}${draftUrl('findings.md')}`, mine)).status).toBe(200)
    await live.nextEvent(
      (event) => event.type === 'draft-changed' && event.path === 'findings.md',
    )

    // Now the reviewer types again without it reaching disk yet, and the agent
    // rewrites the same Draft underneath.
    const theirs = '# Findings\n\nRewritten wholesale by the agent.\n'
    await live.write('findings.md', theirs)

    const event = await live.nextEvent(
      (candidate) => candidate.type === 'draft-changed' && candidate.path === 'findings.md',
    )
    expect(event).toEqual({ type: 'draft-changed', path: 'findings.md' })

    // Take-theirs has something to load…
    const onDisk = (await (
      await fetch(`${live.url}${draftUrl('findings.md')}`)
    ).json()) as DraftContents
    expect(onDisk.content).toBe(theirs)
  })

  it('lets keep-mine win: the reviewer’s buffer goes over the agent’s rewrite', async () => {
    live = await startLiveReview({ 'findings.md': DRAFT })

    const theirs = '# Findings\n\nRewritten wholesale by the agent.\n'
    await live.write('findings.md', theirs)
    await live.nextEvent(
      (event) => event.type === 'draft-changed' && event.path === 'findings.md',
    )

    const mine = `${DRAFT}\nMine, and I meant it.\n`
    expect((await put(`${live.url}${draftUrl('findings.md')}`, mine)).status).toBe(200)

    const after = (await (
      await fetch(`${live.url}${draftUrl('findings.md')}`)
    ).json()) as DraftContents
    expect(after.content).toBe(mine)
  })

  it('lets take-theirs win: no write, and the read is the agent’s version', async () => {
    live = await startLiveReview({ 'findings.md': DRAFT })

    const theirs = '# Findings\n\nRewritten wholesale by the agent.\n'
    await live.write('findings.md', theirs)
    await live.nextEvent(
      (event) => event.type === 'draft-changed' && event.path === 'findings.md',
    )

    // Discarding the buffer is the absence of a write, so nothing is sent.
    const after = (await (
      await fetch(`${live.url}${draftUrl('findings.md')}`)
    ).json()) as DraftContents
    expect(after.content).toBe(theirs)
  })
})
