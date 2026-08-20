import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { Hono } from 'hono'
import type {
  DraftContents,
  Handoff,
  NewNote,
  Note,
  Reanchor,
  Reply,
  ReplyAuthor,
  ResolvedNote,
  ReviewListing,
} from '../shared/types.js'
import { captureAnchor, locateAnchor } from './anchor.js'
import { handoffInstruction } from './handoff.js'
import { listDrafts, readDraft, writeDraft } from './review.js'
import { mutateNotes, readNotes } from './sidecar.js'
import { normalised, statusOf } from './status.js'

/** Attach each Note to the Draft as it stands right now. */
function resolveNotes(notes: Note[], content: string): ResolvedNote[] {
  return notes.map((note) => {
    const located = locateAnchor(content, note.anchor)
    return {
      ...normalised(note),
      anchor: { ...note.anchor, orphaned: located === undefined },
      range: located ? { from: located.from, to: located.to } : null,
      match: located?.match ?? 'orphaned',
    }
  })
}

/**
 * Record in the sidecar which Notes have lost their Anchor.
 *
 * Reading is what discovers this — the agent rewrites a Draft and the Note only
 * comes loose next time someone looks. Writing the flag back keeps the file
 * honest for the agent reading it, and the write is skipped unless something
 * actually changed, so a read stays a read in the normal case.
 */
async function recordOrphans(
  reviewRoot: string,
  stored: Note[],
  resolved: ResolvedNote[],
): Promise<void> {
  const nowOrphaned = new Map(resolved.map((note) => [note.id, note.range === null]))

  const changed = stored.some((note) => {
    const orphaned = nowOrphaned.get(note.id)
    return orphaned !== undefined && Boolean(note.anchor.orphaned) !== orphaned
  })
  if (!changed) return

  await mutateNotes(reviewRoot, (notes) =>
    notes.map((note) => {
      const orphaned = nowOrphaned.get(note.id)
      if (orphaned === undefined || Boolean(note.anchor.orphaned) === orphaned) return note
      return { ...note, anchor: { ...note.anchor, orphaned } }
    }),
  )
}

/**
 * Change one Note in place, returning it, or undefined if it isn't there.
 * `updatedAt` moves on every change so the client can tell something happened.
 */
async function changeNote(
  reviewRoot: string,
  id: string,
  change: (note: Note) => Note,
): Promise<Note | undefined> {
  let updated: Note | undefined

  await mutateNotes(reviewRoot, (notes) =>
    notes.map((note) => {
      if (note.id !== id) return note
      updated = { ...change(note), updatedAt: new Date().toISOString() }
      return updated
    }),
  )

  return updated
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
      drafts: drafts.map((draft) => {
        const own = notes.filter((note) => note.draftPath === draft.path)
        return {
          ...draft,
          openNoteCount: own.filter((note) => statusOf(note) === 'open').length,
          answeredNoteCount: own.filter((note) => statusOf(note) === 'answered').length,
        }
      }),
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
    const resolved = resolveNotes(notes, draft.content)
    await recordOrphans(root, notes, resolved)

    const contents: DraftContents = { path: draftPath, ...draft, notes: resolved }
    return c.json(contents)
  })

  // Writing a Draft back. The Draft pane is a real editor and the file on disk
  // is authoritative (`docs/adr/0003`), so the reviewer's autosave lands here.
  // The whole Draft is sent, not a patch: the buffer is what the reviewer means
  // the file to say, and a whole-file write is the same shape the agent uses.
  app.put('/api/draft', async (c) => {
    const draftPath = c.req.query('path')
    if (!draftPath) return c.json({ error: 'Ask for a Draft by path' }, 400)

    const submitted = (await c.req.json().catch(() => undefined)) as
      | { content?: unknown }
      | undefined
    if (typeof submitted?.content !== 'string') {
      return c.json({ error: 'A Draft is written with its full content' }, 400)
    }

    const written = await writeDraft(root, draftPath, submitted.content)
    if (!written) return c.json({ error: `No such Draft in this Review: ${draftPath}` }, 404)

    // Same bookkeeping a read does: the reviewer can edit an anchored passage
    // away just as the agent can, and the sidecar should say so.
    const notes = (await readNotes(root)).filter((note) => note.draftPath === draftPath)
    const resolved = resolveNotes(notes, submitted.content)
    await recordOrphans(root, notes, resolved)

    const contents: DraftContents = {
      path: draftPath,
      extension: written.extension,
      content: submitted.content,
      notes: resolved,
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
      replies: [],
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

    const updated = await changeNote(root, id, (note) => ({
      ...note,
      body: (submitted.body as string).trim(),
    }))

    if (!updated) return c.json({ error: `No such Note: ${id}` }, 404)
    return c.json(updated)
  })

  app.post('/api/notes/:id/replies', async (c) => {
    const id = c.req.param('id')
    const submitted = (await c.req.json().catch(() => undefined)) as
      | { body?: unknown; author?: unknown }
      | undefined

    if (typeof submitted?.body !== 'string' || submitted.body.trim() === '') {
      return c.json({ error: 'A Reply needs something to say' }, 400)
    }
    const author: ReplyAuthor = submitted.author === 'agent' ? 'agent' : 'reviewer'

    const reply: Reply = {
      id: randomUUID(),
      author,
      body: submitted.body.trim(),
      createdAt: new Date().toISOString(),
    }

    const updated = await changeNote(root, id, (note) => ({
      ...note,
      replies: [...note.replies, reply],
      // A Reply from the reviewer reopens a Note the agent had answered.
      status: author === 'agent' ? 'answered' : 'open',
    }))

    if (!updated) return c.json({ error: `No such Note: ${id}` }, 404)
    return c.json(updated, 201)
  })

  app.post('/api/notes/:id/reanchor', async (c) => {
    const id = c.req.param('id')
    const submitted = (await c.req.json().catch(() => undefined)) as
      | Partial<Reanchor>
      | undefined

    if (typeof submitted?.from !== 'number' || typeof submitted.to !== 'number') {
      return c.json({ error: 'Re-attaching a Note needs a from/to range' }, 400)
    }

    const existing = (await readNotes(root)).find((note) => note.id === id)
    if (!existing) return c.json({ error: `No such Note: ${id}` }, 404)

    const draft = await readDraft(root, existing.draftPath)
    if (!draft) return c.json({ error: `No such Draft: ${existing.draftPath}` }, 404)

    const { from, to } = submitted
    if (from < 0 || to > draft.content.length || from >= to) {
      return c.json({ error: 'That range is not in the Draft' }, 400)
    }

    // A fresh Anchor, so the Note is no longer orphaned by construction.
    const updated = await changeNote(root, id, (note) => ({
      ...note,
      anchor: captureAnchor(draft.content, from, to),
    }))

    return c.json(updated!)
  })

  app.post('/api/notes/:id/resolve', async (c) => {
    const updated = await changeNote(root, c.req.param('id'), (note) => ({
      ...note,
      status: 'resolved',
    }))

    if (!updated) return c.json({ error: `No such Note: ${c.req.param('id')}` }, 404)
    return c.json(updated)
  })

  app.get('/api/handoff', async (c) => {
    const notes = await readNotes(root)
    const outstanding = notes.filter((note) => statusOf(note) !== 'resolved')

    const handoff: Handoff = {
      instruction: handoffInstruction(root, notes),
      openNoteCount: outstanding.filter((note) => statusOf(note) === 'open').length,
      answeredNoteCount: outstanding.filter((note) => statusOf(note) === 'answered').length,
    }
    return c.json(handoff)
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
