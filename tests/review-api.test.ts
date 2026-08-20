import { afterEach, describe, expect, it } from 'vitest'
import type { DraftContents, ReviewListing } from '../src/shared/types.js'
import { createReviewFixture, type ReviewFixture } from './helpers/review-fixture.js'

const draftUrl = (draftPath: string) => `/api/draft?${new URLSearchParams({ path: draftPath })}`

let fixture: ReviewFixture | undefined

afterEach(async () => {
  await fixture?.cleanup()
  fixture = undefined
})

describe('listing a Review', () => {
  it('lists every Draft at any depth, with paths relative to the Review root', async () => {
    fixture = await createReviewFixture({
      'intro.md': '# Intro',
      'guides/setup.md': '# Setup',
      'guides/deep/advanced.html': '<h1>Advanced</h1>',
      'notes.txt': 'plain',
    })

    const review = await fixture.getJson<ReviewListing>('/api/review')

    expect(review.drafts.map((draft) => draft.path)).toEqual([
      'guides/deep/advanced.html',
      'guides/setup.md',
      'intro.md',
      'notes.txt',
    ])
    expect(review.root).toBe(fixture.root)
  })

  it('reports each Draft with its own name and extension', async () => {
    fixture = await createReviewFixture({ 'guides/setup.md': '# Setup' })

    const review = await fixture.getJson<ReviewListing>('/api/review')

    expect(review.drafts).toEqual([
      {
        path: 'guides/setup.md',
        name: 'setup.md',
        extension: '.md',
        openNoteCount: 0,
        answeredNoteCount: 0,
      },
    ])
  })

  it('leaves out files that are not a reviewable format', async () => {
    fixture = await createReviewFixture({
      'keep.md': 'yes',
      'skip.json': '{}',
      'skip.png': 'binary-ish',
      'skip': 'no extension at all',
    })

    const review = await fixture.getJson<ReviewListing>('/api/review')

    expect(review.drafts.map((draft) => draft.path)).toEqual(['keep.md'])
  })

  it('does not walk into hidden folders, node_modules, or the sidecar folder', async () => {
    fixture = await createReviewFixture({
      'keep.md': 'yes',
      '.hidden/secret.md': 'no',
      'node_modules/pkg/readme.md': 'no',
      '.feedback/notes.json': '{}',
    })

    const review = await fixture.getJson<ReviewListing>('/api/review')

    expect(review.drafts.map((draft) => draft.path)).toEqual(['keep.md'])
  })

  it('reports an empty Review rather than failing', async () => {
    fixture = await createReviewFixture()

    const review = await fixture.getJson<ReviewListing>('/api/review')

    expect(review.drafts).toEqual([])
  })
})

describe('reading a Draft', () => {
  it('returns the Draft contents verbatim', async () => {
    const content = '# Setup\n\nRun the thing.\n'
    fixture = await createReviewFixture({ 'guides/setup.md': content })

    const draft = await fixture.getJson<DraftContents>(draftUrl('guides/setup.md'))

    expect(draft).toEqual({ path: 'guides/setup.md', extension: '.md', content, notes: [] })
  })

  it('handles a Draft whose name needs escaping in a URL', async () => {
    fixture = await createReviewFixture({ 'release notes.md': 'shipped' })

    const draft = await fixture.getJson<DraftContents>(draftUrl('release notes.md'))

    expect(draft.content).toBe('shipped')
  })

  it('404s for a Draft that is not in the Review', async () => {
    fixture = await createReviewFixture({ 'intro.md': '# Intro' })

    const response = await fixture.request(draftUrl('missing.md'))

    expect(response.status).toBe(404)
  })

  it('refuses to read outside the Review root', async () => {
    fixture = await createReviewFixture({ 'intro.md': '# Intro' })

    await fixture.writeOutside('leak.md', 'not yours to read')

    const response = await fixture.request(draftUrl('../leak.md'))

    expect(response.status).toBe(404)
  })

  it('refuses an absolute path', async () => {
    fixture = await createReviewFixture({ 'intro.md': '# Intro' })
    await fixture.writeOutside('leak.md', 'not yours to read')

    const response = await fixture.request(draftUrl(`${fixture.root}/../leak.md`))

    expect(response.status).toBe(404)
  })

  it('400s when no path is given', async () => {
    fixture = await createReviewFixture({ 'intro.md': '# Intro' })

    const response = await fixture.request('/api/draft')

    expect(response.status).toBe(400)
  })

  it('refuses to read a file that is not a reviewable format', async () => {
    fixture = await createReviewFixture({ 'secrets.json': '{"token":"nope"}' })

    const response = await fixture.request(draftUrl('secrets.json'))

    expect(response.status).toBe(404)
  })
})
