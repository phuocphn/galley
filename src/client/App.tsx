import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DraftContents, NoteStatus, ReviewListing } from '../shared/types.js'
import {
  addReply,
  createNote,
  deleteNote,
  fetchDraft,
  fetchHandoff,
  fetchReview,
  resolveNote,
} from './api.js'
import { DraftPane } from './components/DraftPane.js'
import { FileTree } from './components/FileTree.js'
import { HandoffButton } from './components/HandoffButton.js'
import { OrphanedNotes, type OrphanedNote } from './components/OrphanedNotes.js'
import { ScopedNotes } from './components/ScopedNotes.js'
import { useReviewEvents } from './useReviewEvents.js'

export function App() {
  const [review, setReview] = useState<ReviewListing>()
  const [selectedPath, setSelectedPath] = useState<string>()
  const [draft, setDraft] = useState<DraftContents>()
  const [showResolved, setShowResolved] = useState(false)
  const [reattaching, setReattaching] = useState<string>()
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
    setReattaching(undefined)
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
    // The listing is always reloaded: a Review Note changes nothing in the pane
    // but everything in the sidebar, and can be left when no Draft is open.
    const [contents, listing] = await Promise.all([
      path ? fetchDraft(path) : undefined,
      fetchReview(),
    ])
    setReview(listing)
    if (contents && selected.current === path) setDraft(contents)
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

  /**
   * The Notes about this Draft as a whole. They have no Anchor, so the pane has
   * nowhere to draw them; they are pinned above it instead. Keeping them out of
   * the pane's Notes is also what stops an Anchor-less Note from being read as
   * an Orphaned one — both have no range, for entirely different reasons.
   */
  const draftScopeNotes = useMemo(
    () => draft?.notes.filter((note) => !note.anchor) ?? [],
    [draft],
  )

  const visibleDraft = useMemo(() => {
    if (!draft) return undefined
    const ranged = draft.notes.filter((note) => note.anchor)
    return {
      ...draft,
      notes: showResolved ? ranged : ranged.filter((note) => note.status !== 'resolved'),
    }
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

  // Review Notes are on no Draft, so no Draft's count carries them. They are
  // added in by hand here rather than being left out of the Review's totals.
  const inReview = (status: NoteStatus): number =>
    review.reviewNotes.filter((note) => note.status === status).length
  const open =
    review.drafts.reduce((total, item) => total + item.openNoteCount, 0) + inReview('open')
  const answered =
    review.drafts.reduce((total, item) => total + item.answeredNoteCount, 0) + inReview('answered')

  // Draft-Scope Notes carry their own toggle, in their own section.
  const resolvedHere =
    draft?.notes.filter((note) => note.anchor && note.status === 'resolved').length ?? 0
  // An Orphaned Note had an Anchor and lost it. A Draft-Scope Note never had
  // one, and has already been taken out of the pane's Notes above.
  const orphaned = (visibleDraft?.notes ?? []).filter(
    (note): note is OrphanedNote => Boolean(note.anchor) && note.range === null,
  )

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
          <ScopedNotes
            scope="review"
            subject={review.name}
            notes={review.reviewNotes}
            onCreate={(body, kind) => void createNote({ body, kind }).then(refresh)}
            onReply={(id, body) => void addReply(id, body).then(refresh)}
            onResolve={(id) => void resolveNote(id).then(refresh)}
            onDelete={(id) => void deleteNote(id).then(refresh)}
          />
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
              <ScopedNotes
                scope="draft"
                subject={selectedPath}
                notes={draftScopeNotes}
                onCreate={(body, kind) =>
                  void createNote({ draftPath: selectedPath, body, kind }).then(refresh)
                }
                onReply={(id, body) => void addReply(id, body).then(refresh)}
                onResolve={(id) => void resolveNote(id).then(refresh)}
                onDelete={(id) => void deleteNote(id).then(refresh)}
              />
              <OrphanedNotes
                notes={orphaned}
                reattaching={reattaching}
                onReattach={setReattaching}
                onCancelReattach={() => setReattaching(undefined)}
                onResolve={(id) => void resolveNote(id).then(refresh)}
                onDelete={(id) => void deleteNote(id).then(refresh)}
              />
              <div className="min-h-0 flex-1">
                {visibleDraft ? (
                  <DraftPane
                    draft={visibleDraft}
                    reattaching={reattaching}
                    onNotesChanged={refresh}
                    onReattached={() => setReattaching(undefined)}
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
