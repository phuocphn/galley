import { useEffect, useState } from 'react'
import type { DraftContents, ReviewListing } from '../shared/types.js'
import { fetchDraft, fetchReview } from './api.js'
import { DraftPane } from './components/DraftPane.js'
import { FileTree } from './components/FileTree.js'

export function App() {
  const [review, setReview] = useState<ReviewListing>()
  const [selectedPath, setSelectedPath] = useState<string>()
  const [draft, setDraft] = useState<DraftContents>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    fetchReview()
      .then((listing) => {
        setReview(listing)
        setSelectedPath(listing.drafts[0]?.path)
      })
      .catch((cause: Error) => setError(cause.message))
  }, [])

  useEffect(() => {
    if (!selectedPath) return
    let current = true
    setDraft(undefined)
    fetchDraft(selectedPath)
      .then((contents) => {
        if (current) setDraft(contents)
      })
      .catch((cause: Error) => {
        if (current) setError(cause.message)
      })
    return () => {
      current = false
    }
  }, [selectedPath])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="max-w-md text-[13px] text-[#d1242f]">{error}</p>
      </div>
    )
  }

  if (!review) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[13px] text-[var(--review-dim)]">Opening Review…</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-baseline gap-2 border-b border-[var(--review-border)] px-4 py-2.5">
        <h1 className="text-[14px] font-semibold">{review.name}</h1>
        <span className="truncate text-[12px] text-[var(--review-dim)]">{review.root}</span>
        <span className="ml-auto text-[12px] text-[var(--review-dim)]">
          {review.drafts.length} {review.drafts.length === 1 ? 'Draft' : 'Drafts'}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Drafts"
          className="w-72 shrink-0 overflow-y-auto border-r border-[var(--review-border)] bg-[var(--review-muted)]"
        >
          <FileTree
            drafts={review.drafts}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
          />
        </nav>

        <main className="flex min-w-0 flex-1 flex-col">
          {selectedPath ? (
            <>
              <div className="shrink-0 border-b border-[var(--review-border)] bg-[var(--review-muted)] px-4 py-2 text-[12px] font-semibold">
                {selectedPath}
              </div>
              <div className="min-h-0 flex-1">
                {draft ? (
                  <DraftPane
                    path={draft.path}
                    extension={draft.extension}
                    content={draft.content}
                  />
                ) : (
                  <p className="p-4 text-[13px] text-[var(--review-dim)]">Loading Draft…</p>
                )}
              </div>
            </>
          ) : (
            <p className="p-4 text-[13px] text-[var(--review-dim)]">
              Select a Draft to start reviewing.
            </p>
          )}
        </main>
      </div>
    </div>
  )
}
