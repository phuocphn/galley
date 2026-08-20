import type { DraftContents, NewNote, Note, ReviewListing } from '../shared/types.js'

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

export function createNote(note: NewNote): Promise<Note> {
  return send<Note>('/api/notes', asJson('POST', note))
}

export function updateNote(id: string, body: string): Promise<Note> {
  return send<Note>(`/api/notes/${id}`, asJson('PATCH', { body }))
}

export function deleteNote(id: string): Promise<void> {
  return send<void>(`/api/notes/${id}`, { method: 'DELETE' })
}
