import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { Hono } from 'hono'
import type {
  DraftContents,
  NewNote,
  Note,
  ResolvedNote,
  ReviewListing,
} from '../shared/types.js'
import { captureAnchor, locateAnchor } from './anchor.js'
import { listDrafts, readDraft } from './review.js'
import { mutateNotes, readNotes } from './sidecar.js'

/** Attach each Note to the Draft as it stands right now. */
function resolveNotes(notes: Note[], content: string): ResolvedNote[] {
  return notes.map((note) => ({ ...note, range: locateAnchor(content, note.anchor) ?? null }))
}

/**
 * The Review API. Everything the client can do to a Review goes through here,
 * which also makes it the single seam the tests drive.
 */
export function createReviewApp(reviewRoot: string): Hono {
  const root = path.resolve(reviewRoot)
  const app = new Hono()

  app.get('/api/review', async (c) => {
    const [drafts, notes] = await Promise.all([listDrafts(root), readNotes(root)])

    const listing: ReviewListing = {
      root,
      name: path.basename(root),
      drafts: drafts.map((draft) => ({
        ...draft,
        openNoteCount: notes.filter(
          (note) => note.draftPath === draft.path && note.status === 'open',
        ).length,
      })),
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

    const notes = (await readNotes(root)).filter((note) => note.draftPath === draftPath)

    const contents: DraftContents = {
      path: draftPath,
      ...draft,
      notes: resolveNotes(notes, draft.content),
    }
    return c.json(contents)
  })

  app.post('/api/notes', async (c) => {
    const submitted = (await c.req.json().catch(() => undefined)) as Partial<NewNote> | undefined
    if (!submitted) return c.json({ error: 'Expected a JSON body' }, 400)

    const { draftPath, from, to, body } = submitted
    if (typeof draftPath !== 'string' || typeof from !== 'number' || typeof to !== 'number') {
      return c.json({ error: 'A Note needs a draftPath and a from/to range' }, 400)
    }
    if (typeof body !== 'string' || body.trim() === '') {
      return c.json({ error: 'A Note needs something to say' }, 400)
    }

    const draft = await readDraft(root, draftPath)
    if (!draft) return c.json({ error: `No such Draft in this Review: ${draftPath}` }, 404)

    if (from < 0 || to > draft.content.length || from >= to) {
      return c.json({ error: 'That range is not in the Draft' }, 400)
    }

    const now = new Date().toISOString()
    const note: Note = {
      id: randomUUID(),
      draftPath,
      anchor: captureAnchor(draft.content, from, to),
      body: body.trim(),
      status: 'open',
      createdAt: now,
      updatedAt: now,
    }

    await mutateNotes(root, (notes) => [...notes, note])
    return c.json(note, 201)
  })

  app.patch('/api/notes/:id', async (c) => {
    const id = c.req.param('id')
    const submitted = (await c.req.json().catch(() => undefined)) as { body?: unknown } | undefined

    if (typeof submitted?.body !== 'string' || submitted.body.trim() === '') {
      return c.json({ error: 'A Note needs something to say' }, 400)
    }

    let updated: Note | undefined
    await mutateNotes(root, (notes) =>
      notes.map((note) => {
        if (note.id !== id) return note
        updated = {
          ...note,
          body: (submitted.body as string).trim(),
          updatedAt: new Date().toISOString(),
        }
        return updated
      }),
    )

    if (!updated) return c.json({ error: `No such Note: ${id}` }, 404)
    return c.json(updated)
  })

  app.delete('/api/notes/:id', async (c) => {
    const id = c.req.param('id')

    let found = false
    await mutateNotes(root, (notes) =>
      notes.filter((note) => {
        if (note.id !== id) return true
        found = true
        return false
      }),
    )

    if (!found) return c.json({ error: `No such Note: ${id}` }, 404)
    return c.body(null, 204)
  })

  return app
}
