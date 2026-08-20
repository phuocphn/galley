import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DraftContents, ReviewListing } from '../shared/types.js'
import { fetchDraft, fetchHandoff, fetchReview } from './api.js'
import { DraftPane } from './components/DraftPane.js'
import { FileTree } from './components/FileTree.js'
import { HandoffButton } from './components/HandoffButton.js'
import { useReviewEvents } from './useReviewEvents.js'

export function App() {
  const [review, setReview] = useState<ReviewListing>()
  const [selectedPath, setSelectedPath] = useState<string>()
  const [draft, setDraft] = useState<DraftContents>()
  const [showResolved, setShowResolved] = useState(false)
  const [error, setError] = useState<string>()

  const selected = useRef<string>(undefined)
  selected.current = selectedPath

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

  /**
   * Reload the Draft and the Review after something changes.
   *
   * The Draft is replaced rather than cleared, so the pane keeps its scroll
   * position and any open thread instead of flickering back to a loading state.
   */
  const refresh = useCallback(async () => {
    const path = selected.current
    if (!path) return
    const [contents, listing] = await Promise.all([fetchDraft(path), fetchReview()])
    if (selected.current !== path) return
    setDraft(contents)
    setReview(listing)
  }, [])

  // The agent works on the same folder while this window is open, so its edits
  // and Replies arrive as pushed events rather than waiting for a refresh.
  useReviewEvents(
    useCallback(
      (event) => {
        if (event.type === 'notes-changed') {
          void refresh()
          return
        }
        if (event.path === selected.current) void refresh()
        else void fetchReview().then(setReview).catch(() => {})
      },
      [refresh],
    ),
  )

  const visibleDraft = useMemo(() => {
    if (!draft) return undefined
    return showResolved
      ? draft
      : { ...draft, notes: draft.notes.filter((note) => note.status !== 'resolved') }
  }, [draft, showResolved])

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

  const open = review.drafts.reduce((total, item) => total + item.openNoteCount, 0)
  const answered = review.drafts.reduce((total, item) => total + item.answeredNoteCount, 0)
  const resolvedHere = draft?.notes.filter((note) => note.status === 'resolved').length ?? 0
  const unplaced = visibleDraft?.notes.filter((note) => note.range === null).length ?? 0

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--review-border)] px-4 py-2">
        <h1 className="text-[14px] font-semibold">{review.name}</h1>
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--review-dim)]">
          {review.root}
        </span>
        <span className="shrink-0 text-[12px] text-[var(--review-dim)]">
          {open} open
          {answered > 0 && <> · {answered} answered</>}
        </span>
        <HandoffButton load={fetchHandoff} />
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Drafts"
          className="w-72 shrink-0 overflow-y-auto border-r border-[var(--review-border)] bg-[var(--review-muted)]"
        >
          <FileTree drafts={review.drafts} selectedPath={selectedPath} onSelect={setSelectedPath} />
        </nav>

        <main className="flex min-w-0 flex-1 flex-col">
          {selectedPath ? (
            <>
              <div className="flex shrink-0 items-center gap-3 border-b border-[var(--review-border)] bg-[var(--review-muted)] px-4 py-1.5 text-[12px]">
                <span className="font-semibold">{selectedPath}</span>
                {resolvedHere > 0 && (
                  <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 text-[var(--review-dim)]">
                    <input
                      type="checkbox"
                      checked={showResolved}
                      onChange={(event) => setShowResolved(event.target.checked)}
                    />
                    Show {resolvedHere} resolved
                  </label>
                )}
              </div>
              {unplaced > 0 && (
                <p className="shrink-0 border-b border-[#d4a72c66] bg-[#fff8c5] px-4 py-2 text-[12px]">
                  {unplaced} {unplaced === 1 ? 'Note' : 'Notes'} could not be found in this Draft
                  any more.
                </p>
              )}
              <div className="min-h-0 flex-1">
                {visibleDraft ? (
                  <DraftPane draft={visibleDraft} onNotesChanged={refresh} />
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
