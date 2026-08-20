import type {
  DraftContents,
  Handoff,
  NewNote,
  Note,
  NoteChange,
  Reanchor,
  ReplyAuthor,
  ReviewListing,
} from '../shared/types.js'

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${response.status}`)
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

function asJson(method: string, value: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }
}

export function fetchReview(): Promise<ReviewListing> {
  return send<ReviewListing>('/api/review')
}

export function fetchDraft(draftPath: string): Promise<DraftContents> {
  return send<DraftContents>(`/api/draft?${new URLSearchParams({ path: draftPath })}`)
}

/**
 * Write a Draft back to disk. The whole buffer goes, because the buffer is what
 * the reviewer means the file to say — see `docs/adr/0003`. The response is the
 * Draft as the server now reads it, with its Notes re-located in the new text.
 */
export function saveDraft(draftPath: string, content: string): Promise<DraftContents> {
  return send<DraftContents>(
    `/api/draft?${new URLSearchParams({ path: draftPath })}`,
    asJson('PUT', { content }),
  )
}

export function createNote(note: NewNote): Promise<Note> {
  return send<Note>('/api/notes', asJson('POST', note))
}

/** A bare string is the Note's new text, the long-hand form its new Kind too. */
export function updateNote(id: string, change: string | NoteChange): Promise<Note> {
  return send<Note>(
    `/api/notes/${id}`,
    asJson('PATCH', typeof change === 'string' ? { body: change } : change),
  )
}

export function deleteNote(id: string): Promise<void> {
  return send<void>(`/api/notes/${id}`, { method: 'DELETE' })
}

export function addReply(id: string, body: string, author: ReplyAuthor = 'reviewer'): Promise<Note> {
  return send<Note>(`/api/notes/${id}/replies`, asJson('POST', { body, author }))
}

export function reanchorNote(id: string, range: Reanchor): Promise<Note> {
  return send<Note>(`/api/notes/${id}/reanchor`, asJson('POST', range))
}

export function resolveNote(id: string): Promise<Note> {
  return send<Note>(`/api/notes/${id}/resolve`, { method: 'POST' })
}

export function fetchHandoff(): Promise<Handoff> {
  return send<Handoff>('/api/handoff')
}
