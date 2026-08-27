import type {
  DraftContents,
  DraftWritten,
  Flag,
  FlagChange,
  Handoff,
  NewFlag,
  NewNote,
  Note,
  NoteChange,
  Reanchor,
  ReplyAuthor,
  ReviewListing,
} from '../shared/types.js'
import { reviewBase } from './base.js'

/** Every request is about the Review this page was loaded from. */
function url(pathname: string): string {
  return `${reviewBase()}${pathname}`
}

async function send<T>(target: string, init?: RequestInit): Promise<T> {
  const response = await fetch(target, init)
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
  return send<ReviewListing>(url('/api/review'))
}

export function fetchDraft(draftPath: string): Promise<DraftContents> {
  return send<DraftContents>(url(`/api/draft?${new URLSearchParams({ path: draftPath })}`))
}

/**
 * Write a Draft back to disk. The whole buffer goes, because the buffer is what
 * the reviewer means the file to say — see `docs/adr/0003`. Nothing comes back
 * about the Notes: a write does not locate Anchors — see `docs/adr/0007`.
 */
export function saveDraft(draftPath: string, content: string): Promise<DraftWritten> {
  return send<DraftWritten>(
    url(`/api/draft?${new URLSearchParams({ path: draftPath })}`),
    asJson('PUT', { content }),
  )
}

export function createNote(note: NewNote): Promise<Note> {
  return send<Note>(url('/api/notes'), asJson('POST', note))
}

export function updateNote(id: string, change: NoteChange): Promise<Note> {
  return send<Note>(url(`/api/notes/${id}`), asJson('PATCH', change))
}

export function deleteNote(id: string): Promise<void> {
  return send<void>(url(`/api/notes/${id}`), { method: 'DELETE' })
}

export function addReply(id: string, body: string, author: ReplyAuthor = 'reviewer'): Promise<Note> {
  return send<Note>(url(`/api/notes/${id}/replies`), asJson('POST', { body, author }))
}

export function reanchorNote(id: string, range: Reanchor): Promise<Note> {
  return send<Note>(url(`/api/notes/${id}/reanchor`), asJson('POST', range))
}

export function resolveNote(id: string): Promise<Note> {
  // Bodyless, but sent as JSON all the same: the Desk refuses a state-changing
  // request that a form could have made (`docs/adr/0008`).
  return send<Note>(url(`/api/notes/${id}/resolve`), asJson('POST', {}))
}

/**
 * Raise a Flag. It goes to `.feedback/flags.json`, which the agent is never
 * pointed at — see `docs/adr/0010`.
 */
export function createFlag(flag: NewFlag): Promise<Flag> {
  return send<Flag>(url('/api/flags'), asJson('POST', flag))
}

/** Write down why a Flag was raised, or change it. Empty text removes it. */
export function updateFlag(id: string, change: FlagChange): Promise<Flag> {
  return send<Flag>(url(`/api/flags/${id}`), asJson('PATCH', change))
}

/** Clear a Flag. There is no cleared state: it is gone. */
export function clearFlag(id: string): Promise<void> {
  return send<void>(url(`/api/flags/${id}`), { method: 'DELETE' })
}

export function fetchHandoff(): Promise<Handoff> {
  return send<Handoff>(url('/api/handoff'))
}
