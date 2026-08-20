import type { DraftContents, ReviewListing } from '../shared/types.js'

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${response.status}`)
  }
  return (await response.json()) as T
}

export function fetchReview(): Promise<ReviewListing> {
  return getJson<ReviewListing>('/api/review')
}

export function fetchDraft(draftPath: string): Promise<DraftContents> {
  return getJson<DraftContents>(`/api/draft?${new URLSearchParams({ path: draftPath })}`)
}
