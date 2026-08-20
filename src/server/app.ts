import path from 'node:path'
import { Hono } from 'hono'
import type { DraftContents, ReviewListing } from '../shared/types.js'
import { listDrafts, readDraft } from './review.js'

/**
 * The Review API. Everything the client can do to a Review goes through here,
 * which also makes it the single seam the tests drive.
 */
export function createReviewApp(reviewRoot: string): Hono {
  const root = path.resolve(reviewRoot)
  const app = new Hono()

  app.get('/api/review', async (c) => {
    const listing: ReviewListing = {
      root,
      name: path.basename(root),
      drafts: await listDrafts(root),
    }
    return c.json(listing)
  })

  // The Draft path travels as a query parameter rather than a path segment:
  // URL parsing silently normalises dot segments out of a pathname, which would
  // both mangle legitimate paths and hide traversal attempts from the guard.
  app.get('/api/draft', async (c) => {
    const draftPath = c.req.query('path')
    if (!draftPath) return c.json({ error: 'Ask for a Draft by path' }, 400)

    const draft = await readDraft(root, draftPath)
    if (!draft) return c.json({ error: `No such Draft in this Review: ${draftPath}` }, 404)

    const contents: DraftContents = { path: draftPath, ...draft }
    return c.json(contents)
  })

  return app
}
