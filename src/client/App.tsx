import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DraftContents, Flag, NoteStatus, ReviewListing } from '../shared/types.js'
import {
  addReply,
  clearFlag,
  createNote,
  deleteNote,
  fetchDraft,
  fetchHandoff,
  fetchReview,
  resolveNote,
  updateFlag,
} from './api.js'
import { DraftPane } from './components/DraftPane.js'
import { FileTree } from './components/FileTree.js'
import { FlagList } from './components/FlagList.js'
import { HandoffButton } from './components/HandoffButton.js'
import { ScopedNotes } from './components/ScopedNotes.js'
import { SidebarToggle } from './components/SidebarToggle.js'
import { useCollapsibleSidebar } from './useCollapsibleSidebar.js'
import { useReviewEvents } from './useReviewEvents.js'

export function App() {
  const [review, setReview] = useState<ReviewListing>()
  const [selectedPath, setSelectedPath] = useState<string>()
  const [draft, setDraft] = useState<DraftContents>()
  const [showResolved, setShowResolved] = useState(false)
  const [reattaching, setReattaching] = useState<string>()
  /** A Flag the reviewer clicked in the sidebar, waiting for its Draft to open. */
  const [goToFlag, setGoToFlag] = useState<string>()
  /** A Flag on its way to becoming a Note, likewise. */
  const [promotingFlag, setPromotingFlag] = useState<string>()
  const [error, setError] = useState<string>()
  const sidebar = useCollapsibleSidebar()

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

  // A refresh already in flight, and whether another was asked for while it ran.
  const refreshing = useRef<Promise<void>>(undefined)
  const refreshAgain = useRef(false)

  /**
   * Reload the Draft and the Review after something changes.
   *
   * The Draft is replaced rather than cleared, so the pane keeps its scroll
   * position and any open thread instead of flickering back to a loading state.
   *
   * Refreshes coalesce. One change routinely asks for several: the reviewer
   * resolves a Note, the caller refreshes, and the watcher sees the server's own
   * write to the sidecar and announces it, which asks again — and an agent
   * replying to a dozen Notes writes the sidecar a dozen times. Both triggers are
   * worth keeping, because the direct one is what makes a click feel answered and
   * the announced one is what carries the agent's work, so it is the duplication
   * that is dropped rather than either path. A request arriving mid-flight is not
   * discarded: it is remembered and re-run once, because it may have been about a
   * change the in-flight read had already passed by.
   */
  const refresh = useCallback(async (): Promise<void> => {
    if (refreshing.current) {
      refreshAgain.current = true
      return refreshing.current
    }

    const run = async (): Promise<void> => {
      do {
        refreshAgain.current = false
        const path = selected.current
        // The listing is always reloaded: a Review Note changes nothing in the
        // pane but everything in the sidebar, and can be left when no Draft is
        // open.
        const [contents, listing] = await Promise.all([
          path ? fetchDraft(path) : undefined,
          fetchReview(),
        ])
        setReview(listing)
        if (contents && selected.current === path) setDraft(contents)
      } while (refreshAgain.current)
    }

    const started = run().finally(() => {
      refreshing.current = undefined
    })
    refreshing.current = started
    return started
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

  const onWentToFlag = useCallback(() => setGoToFlag(undefined), [])

  /**
   * Take me to this Flag. Selecting the Draft and landing on the passage are
   * one request: the pane answers the second half once the Draft it is on has
   * loaded, so a Flag in another Draft works exactly like one in this Draft.
   */
  const goToTheFlag = useCallback((flag: Flag) => {
    setSelectedPath(flag.draftPath)
    setGoToFlag(flag.id)
  }, [])

  const onPromotedFlag = useCallback(() => setPromotingFlag(undefined), [])

  /**
   * Turn a Flag into a Note on the same passage.
   *
   * Like going to one, this is two halves a render apart: the Draft is selected
   * here, and the pane opens the composer over the passage once that Draft has
   * loaded. It goes through the composer rather than writing a Note outright
   * because a Note needs a Kind and something to say, and a Flag is raised in
   * one gesture with neither — most have no words on them at all.
   */
  const promoteFlag = useCallback((flag: Flag) => {
    setSelectedPath(flag.draftPath)
    setPromotingFlag(flag.id)
  }, [])

  /**
   * The Notes about this Draft as a whole. They have no Anchor, so the pane has
   * nowhere in the text to draw them; they go in its Notes tab instead. Keeping
   * them out of the pane's Notes is also what stops an Anchor-less Note from
   * being read as an Orphaned one — both have no range, for entirely different
   * reasons.
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
  // Notes on the whole Review are only reachable from the sidebar, so the toggle
  // carries their count while it is hidden.
  const outstandingReviewNotes = inReview('open') + inReview('answered')

  // Draft-Scope Notes carry their own toggle, in their own section.
  const resolvedHere =
    draft?.notes.filter((note) => note.anchor && note.status === 'resolved').length ?? 0

  /**
   * Which Flags have lost the text they were about. Only the open Draft can
   * say: locating the rest would mean reading every Draft in the Review on a
   * request that reads none — see `docs/adr/0010`.
   */
  const orphanedFlags = new Set(
    (draft?.flags ?? []).filter((flag) => flag.range === null).map((flag) => flag.id),
  )

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--review-border)] px-4 py-2">
        <SidebarToggle
          collapsed={sidebar.collapsed}
          hiddenReviewNotes={outstandingReviewNotes}
          hiddenFlags={review.flags.length}
          onToggle={sidebar.toggle}
        />
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
          id="review-sidebar"
          aria-label="Drafts"
          hidden={sidebar.collapsed}
          /* Three sections, each scrolling in its own box rather than the
             column scrolling as one: a long Flag list must not push the Draft
             list out of reach, which is the whole reason to keep it here. */
          className="flex w-72 shrink-0 flex-col border-r border-[var(--review-border)] bg-[var(--review-muted)]"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FileTree
              drafts={review.drafts}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
            />
          </div>
          {/* Above the Review Notes: Flags are what you come back to over and
              over, and Review Notes are written once and left. */}
          <FlagList
            flags={review.flags}
            selectedPath={selectedPath}
            orphanedIds={orphanedFlags}
            onGo={goToTheFlag}
            onReason={(id, reason) => void updateFlag(id, { reason }).then(refresh)}
            onPromote={promoteFlag}
            onClear={(id) => void clearFlag(id).then(refresh)}
          />
          <div className="max-h-[40%] shrink-0 overflow-y-auto">
            <ScopedNotes
              scope="review"
              subject={review.name}
              notes={review.reviewNotes}
              onCreate={(body, kind) => void createNote({ body, kind }).then(refresh)}
              onReply={(id, body) => void addReply(id, body).then(refresh)}
              onResolve={(id) => void resolveNote(id).then(refresh)}
              onDelete={(id) => void deleteNote(id).then(refresh)}
            />
          </div>
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
              {/* Nothing between this and the Draft. The whole-Draft Notes and
                  the Orphaned ones used to be stacked here and are now in the
                  pane's own Notes tab — see `docs/adr/0012`. */}
              <div className="min-h-0 flex-1">
                {visibleDraft ? (
                  <DraftPane
                    draft={visibleDraft}
                    draftScopeNotes={draftScopeNotes}
                    reattaching={reattaching}
                    goToFlag={goToFlag}
                    onWentToFlag={onWentToFlag}
                    promotingFlag={promotingFlag}
                    onPromotedFlag={onPromotedFlag}
                    onNotesChanged={refresh}
                    onReattach={setReattaching}
                    onCancelReattach={() => setReattaching(undefined)}
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
