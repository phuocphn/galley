import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DraftContents, DraftExtension, ResolvedNote } from '../../shared/types.js'
import {
  addReply,
  createNote,
  deleteNote,
  reanchorNote,
  resolveNote,
  saveDraft,
  updateNote,
} from '../api.js'
import {
  keepingLocalAnchors,
  notes,
  notesField,
  setNotes,
  type NoteHandlers,
} from '../notes/index.js'
import { closeComposer, composerField, openComposer, setEditing, setReattaching } from '../notes/state.js'
import { previewKindFor, type PreviewKind } from '../preview/document.js'
import { asksForANote, type PreviewGesture } from '../preview/frame.js'
import {
  blockAtOffset,
  locateBlock,
  locatePhrase,
  locateRenderedText,
  offsetOfBlock,
  type PreviewLocation,
} from '../preview/mapping.js'
import { usePreviewMode } from '../preview/mode.js'
import { DraftPreview, type PreviewArrival } from './DraftPreview.js'

/**
 * How long the reviewer has to stop typing before the Draft is written.
 *
 * Long enough that a sentence is one write rather than forty; short enough that
 * an agent started straight after typing sees the edit. There is no save button
 * — see `docs/adr/0003` — so this delay is the whole of the save interface.
 */
const AUTOSAVE_IDLE_MS = 500

/** What the toggle bar says while the reviewer is reading the Preview. */
const PREVIEW_HINT = 'Click a passage to open it in the Source. Select one to leave a Note on it.'

/**
 * What the bar says when a gesture could not be pinned to the words it was
 * about. Both leave the reviewer somewhere they can act rather than stuck: the
 * first on the containing block, one drag away from the right Anchor; the
 * second exactly where they were reading.
 */
const AMBIGUOUS_PHRASE =
  'That phrase appears more than once in this block, so the whole block is selected. Narrow it, then press Add note.'
const UNFINDABLE_TEXT = 'That text could not be found in the Source, so nothing has moved.'

/**
 * Where a Preview gesture landed in the Source.
 *
 * Which mapping it goes through is decided by the Draft's format, not by the
 * shape of the message: a Markdown Preview stamps every block as it renders it
 * and looks the range straight up, while an HTML Preview stamps nothing —
 * sanitising and parsing keep no positions — and has to find the rendered words
 * in the Source (`docs/adr/0005`). The frame sends the shape that matches what
 * it was handed, so a message of the other shape is not one we sent, and maps
 * to nothing.
 */
function locatedBy(kind: PreviewKind, source: string, gesture: PreviewGesture): PreviewLocation {
  if (kind === 'html') {
    return gesture.kind === 'text'
      ? locateRenderedText(source, gesture.passage)
      : { outcome: 'not-found' }
  }

  if (gesture.kind === 'click') return locateBlock(source, gesture.block)
  if (gesture.kind === 'select') return locatePhrase(source, gesture)
  return { outcome: 'not-found' }
}

/** Light syntax highlighting per format. `.txt` gets none, by design. */
function languageFor(extension: DraftExtension): Extension[] {
  switch (extension) {
    case '.md':
      return [markdown()]
    case '.html':
      return [html()]
    case '.txt':
      return []
  }
}

/** The version on disk, held back while the reviewer decides what to do with it. */
interface Conflict {
  content: string
  notes: ResolvedNote[]
}

interface DraftPaneProps {
  draft: DraftContents
  /** The Orphaned Note the reviewer is pointing at new text, if any. */
  reattaching: string | undefined
  /** Called after a Note is added, edited, or removed. */
  onNotesChanged: () => Promise<void>
  /** Called once an Orphaned Note has been given a new Anchor. */
  onReattached: () => void
}

export function DraftPane({ draft, reattaching, onNotesChanged, onReattached }: DraftPaneProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  /**
   * Where the Source view was scrolled to when the Preview took the pane.
   *
   * Only an HTML Draft has one. Its two views cannot be kept on the same
   * passage, because sanitising and parsing throw away the positions that would
   * say where a rendered block came from (ADR 0005), so each view keeps its own
   * offset instead. A Markdown Draft's Source position is worked out afresh
   * from the block the Preview was being read at, every time, so there is
   * nothing here to remember and no stale number to go stale.
   */
  const sourceScrollTop = useRef(0)
  /** The block at the top of the Preview, as the frame last reported it. */
  const previewTopBlock = useRef<number | null>(null)
  /**
   * The block the Source view was on as the Preview took the pane.
   *
   * Measured in the commit that hides the Source view rather than in the effect
   * that follows it, because that is the last moment its scroller still says
   * where the reviewer was: hiding the view costs CodeMirror its viewport, and
   * the offset goes with it. Read a paint later, the answer is the top of the
   * Draft every time, which is exactly the "switching views is a navigation
   * task" complaint this is here to answer.
   */
  const arrivingBlock = useRef<number | null>(null)
  /**
   * A range the reviewer pointed at in the Preview, waiting for the Source view
   * to come back so it can be selected. An explicit target — *take me to this*
   * — so it beats the passage the two views would otherwise agree on for that
   * one switch.
   */
  const pendingJump = useRef<{ from: number; to: number; compose: boolean } | null>(null)

  /**
   * The Draft as we last knew it on disk: what we read, or what we last wrote.
   * A buffer that differs from this has edits in it that disk hasn't got.
   */
  const savedContent = useRef(draft.content)
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  /** Writes run one after another, so a burst of typing can't land out of order. */
  const writing = useRef<Promise<void>>(Promise.resolve())

  const [conflict, setConflict] = useState<Conflict>()
  const [saveError, setSaveError] = useState<string>()

  // Read from inside CodeMirror callbacks, which outlive the render that made
  // them: while a conflict is up, the reviewer's answer decides what disk says,
  // so nothing is written until they give one.
  const conflicted = useRef(false)
  conflicted.current = conflict !== undefined

  const [previewing, setPreviewing] = usePreviewMode()
  const previewKind = previewKindFor(draft.extension)
  // The flag outlives any one Draft, so a `.txt` Draft simply shows its source
  // while the reviewer is in preview mode, and rendering resumes on the next
  // Draft that has a preview.
  const showingPreview = previewing && previewKind !== null
  /**
   * Whether the two views can be kept on the same passage at all. Only Markdown
   * stamps its rendered blocks with where they came from, so only Markdown can
   * answer *which passage is this* from either side (ADR 0005).
   */
  const hasBlocks = previewKind === 'markdown'
  // Read from a callback built once, which outlives the render that made it.
  const hasBlocksNow = useRef(false)
  hasBlocksNow.current = hasBlocks

  /**
   * The Source the Preview is rendering: a snapshot of the buffer, taken when
   * the reviewer switched to the Preview — not the server's copy of the Draft.
   *
   * The server's copy diverges routinely (typing does not reach it until
   * autosave fires, the file lands, the watcher notices and the client
   * refetches) and completely while a conflict is unanswered, where it is the
   * *agent's* version and the buffer is the reviewer's. Rendering it would show
   * the reviewer a Draft that is not the one in front of them. The Source view
   * is hidden while the Preview is up, so the buffer cannot move underneath the
   * snapshot: the two are one coordinate space, which is what every offset cut
   * from the Preview depends on. See `docs/adr/0005`.
   *
   * Undefined until the reviewer first asks for the Preview, so a Draft that is
   * never previewed is never rendered.
   */
  const [previewSource, setPreviewSource] = useState<string>()

  /**
   * The reviewer's last arrival in the Preview, carrying the passage the Source
   * view was on as they left it. Set in the same breath as the snapshot above,
   * so the block index and the document it counts blocks in are one decision
   * rather than two that can be taken against different text.
   */
  const [arrival, setArrival] = useState<PreviewArrival>()

  // Read from effects that do not otherwise depend on the flag.
  const showingPreviewNow = useRef(false)
  showingPreviewNow.current = showingPreview

  /**
   * The Source the Preview's blocks were numbered from, for the switch back.
   *
   * Read from a layout effect that must not re-run when the snapshot changes —
   * the snapshot moving is an agent rewriting the Draft, which is not a switch
   * and is nobody's cue to scroll anything.
   */
  const previewSourceNow = useRef<string>(undefined)
  previewSourceNow.current = previewSource

  /**
   * Why the last Preview gesture did not land where it was aimed, if it didn't.
   * The toggle bar is where the reviewer is already looking, so it is where the
   * explanation goes; it lasts until the next gesture or the next switch.
   */
  const [mappingNote, setMappingNote] = useState<string>()

  /**
   * Whether a composer is open in the Source view behind the Preview. The frame
   * cannot see it, and its **Add note** button stands down while one is open —
   * the same rule the Source view's own button follows. The Source view is
   * hidden while the Preview is up, so this can only change on the way in.
   */
  const [composerOpen, setComposerOpen] = useState(false)

  // The extension is built once per view, so it reads the current callbacks
  // through a ref rather than closing over the render that created it.
  const latest = useRef({ draftPath: draft.path, onNotesChanged, onReattached })
  latest.current = { draftPath: draft.path, onNotesChanged, onReattached }

  const stopIdleTimer = useCallback(() => {
    if (idleTimer.current === undefined) return
    clearTimeout(idleTimer.current)
    idleTimer.current = undefined
  }, [])

  /** Write a Draft to disk, behind whatever write is already in flight. */
  const write = useCallback((draftPath: string, content: string): Promise<void> => {
    const next = writing.current.then(async () => {
      if (content === savedContent.current) return
      try {
        await saveDraft(draftPath, content)
        savedContent.current = content
        setSaveError(undefined)
      } catch (cause) {
        setSaveError(cause instanceof Error ? cause.message : 'Could not write the Draft to disk.')
      }
    })
    writing.current = next
    return next
  }, [])

  /** Write what's in the buffer now, rather than waiting out the idle delay. */
  const flush = useCallback((): Promise<void> => {
    stopIdleTimer()
    const editor = view.current
    if (!editor || conflicted.current) return writing.current
    return write(latest.current.draftPath, editor.state.doc.toString())
  }, [stopIdleTimer, write])

  /**
   * Re-read the buffer into the Preview's snapshot. Called when the reviewer
   * switches to the Preview, and again whenever the buffer moves under it —
   * which, with the Source view hidden, only an agent's rewrite can do.
   */
  const snapshotForPreview = useCallback(() => {
    const editor = view.current
    if (editor && showingPreviewNow.current) setPreviewSource(editor.state.doc.toString())
  }, [])

  /**
   * Which block of the Draft the Source view has at the top of it.
   *
   * The top of the *visible* area, which is not where CodeMirror's rendered
   * viewport starts: it renders a margin of lines above and below the screen,
   * so `viewport.from` is routinely most of a screenful early and would land
   * the reviewer above the passage they were reading, every single time.
   * Heights are measured from the top of the document, so the visible top is
   * the scroller's own top less wherever the document currently begins.
   *
   * The buffer is what the blocks are counted from, and it is what the Preview
   * is about to render: this is read in the same breath as the snapshot is
   * taken, and the Source view is hidden from then on, so the two cannot have
   * drifted apart by the time the block index is used.
   */
  const sourceTopBlock = useCallback((): number | null => {
    const editor = view.current
    if (!editor || !hasBlocksNow.current) return null

    const visibleTop = editor.scrollDOM.getBoundingClientRect().top - editor.documentTop
    const line = editor.lineBlockAtHeight(visibleTop)
    return blockAtOffset(editor.state.doc.toString(), line.from)
  }, [])

  /** The Preview reporting where it has been read to, as it is read. */
  const onReadingBlock = useCallback((block: number | null) => {
    previewTopBlock.current = block
  }, [])

  /**
   * Typing schedules a write. The reviewer never asks for one: the Draft pane is
   * an editor and the file is authoritative, so the edit belongs on disk as soon
   * as they stop.
   */
  const autosave = useMemo(
    () =>
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || conflicted.current) return
        stopIdleTimer()
        idleTimer.current = setTimeout(() => {
          idleTimer.current = undefined
          if (conflicted.current) return
          void write(latest.current.draftPath, update.view.state.doc.toString())
        }, AUTOSAVE_IDLE_MS)
      }),
    [stopIdleTimer, write],
  )

  const handlers = useMemo<NoteHandlers>(
    () => ({
      async create(range, note) {
        // The server cuts the Anchor out of the file on disk, so the file has to
        // be saying what the reviewer is looking at before the Note is written.
        // While a conflict is unanswered nothing may be written, so the Anchor
        // would be cut from the wrong text — the composer says so instead.
        if (conflicted.current) {
          throw new Error('This Draft changed on disk. Settle that first, then leave the Note.')
        }
        await flush()
        await createNote({
          draftPath: latest.current.draftPath,
          ...range,
          body: note.body,
          kind: note.kind,
        })
        view.current?.dispatch({ effects: closeComposer.of(null) })
        await latest.current.onNotesChanged()
      },
      async update(id, change) {
        await updateNote(id, change)
        view.current?.dispatch({ effects: setEditing.of(null) })
        await latest.current.onNotesChanged()
      },
      async remove(id) {
        await deleteNote(id)
        await latest.current.onNotesChanged()
      },
      async reply(id, body) {
        await addReply(id, body)
        await latest.current.onNotesChanged()
      },
      async resolve(id) {
        await resolveNote(id)
        await latest.current.onNotesChanged()
      },
      async reattach(id, range) {
        // Same as creating a Note: the new Anchor is cut from what's on disk.
        // Re-attaching is driven from the gutter, which has nowhere to show a
        // refusal, so this leans on the flush rather than turning the reviewer
        // away — a conflict and a re-attachment at the same moment is rare.
        await flush()
        await reanchorNote(id, range)
        latest.current.onReattached()
        await latest.current.onNotesChanged()
      },
    }),
    [flush],
  )

  useEffect(() => {
    if (!host.current) return

    const draftPath = draft.path
    savedContent.current = draft.content

    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: draft.content,
        extensions: [
          EditorView.lineWrapping,
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          ...languageFor(draft.extension),
          // Sometimes fixing the prose is faster than explaining the fix, so the
          // Draft is editable — with undo, since a hand edit is a real edit.
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          autosave,
          notes(handlers),
        ],
      }),
    })
    view.current = editor
    editor.dispatch({ effects: setNotes.of(draft.notes) })
    // A scroll offset, and a reading position, belong to the Draft they were
    // taken from. Neither view's survives a switch to another Draft.
    sourceScrollTop.current = 0
    previewTopBlock.current = null
    // Nor does a snapshot, nor an arrival: this Draft has not been previewed
    // yet, and a block index counts blocks of the Draft it was taken from.
    setPreviewSource(undefined)
    setArrival(undefined)

    return () => {
      // Moving to another Draft is not a reason to lose the last keystrokes.
      stopIdleTimer()
      const pending = editor.state.doc.toString()
      if (!conflicted.current && pending !== savedContent.current) void write(draftPath, pending)

      editor.destroy()
      view.current = null
    }
    // Rebuilt only when the Draft itself changes — never on its content, which
    // now moves under the reviewer's hands. Notes and text arrive as effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.path, draft.extension, handlers, autosave, stopIdleTimer, write])

  /**
   * Reconcile the Draft the server is describing with the buffer in front of the
   * reviewer. Three things can be true, and only the last of them is a decision
   * the reviewer has to make.
   */
  useEffect(() => {
    const editor = view.current
    if (!editor) return

    const buffer = editor.state.doc.toString()

    if (draft.content === buffer) {
      // Whatever landed on disk, it says what the buffer says. Nothing to move.
      savedContent.current = draft.content
      setConflict(undefined)
      editor.dispatch({ effects: setNotes.of(draft.notes) })
      return
    }

    if (draft.content === savedContent.current) {
      // Our own write coming back round the watcher, with the buffer already
      // typed on since. Leaving the buffer alone is the whole point.
      editor.dispatch({
        effects: setNotes.of(keepingLocalAnchors(draft.notes, editor.state.field(notesField))),
      })
      return
    }

    // The Draft changed on disk under us — the agent has been at it.
    if (buffer === savedContent.current) {
      // Nothing of the reviewer's to lose, so take the agent's work silently.
      stopIdleTimer()
      savedContent.current = draft.content
      setConflict(undefined)
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: draft.content },
        effects: setNotes.of(draft.notes),
      })
      snapshotForPreview()
      return
    }

    // Both sides have written. Neither version is ours to throw away.
    stopIdleTimer()
    setConflict({ content: draft.content, notes: draft.notes })
  }, [draft.content, draft.notes, snapshotForPreview, stopIdleTimer])

  const keepMine = useCallback(() => {
    const editor = view.current
    if (!editor) return
    conflicted.current = false
    setConflict(undefined)
    void write(latest.current.draftPath, editor.state.doc.toString())
  }, [write])

  const takeTheirs = useCallback(() => {
    const editor = view.current
    if (!editor || !conflict) return

    savedContent.current = conflict.content
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: conflict.content },
      effects: setNotes.of(conflict.notes),
    })
    snapshotForPreview()
    // Dispatched while the conflict still stands, so autosave stays out of it.
    stopIdleTimer()
    setConflict(undefined)
    // The buffer that failed to save has just been discarded, so any earlier
    // "could not be written" complaint is about work that no longer exists.
    setSaveError(undefined)
  }, [conflict, snapshotForPreview, stopIdleTimer])

  useEffect(() => {
    view.current?.dispatch({ effects: setReattaching.of(reattaching ?? null) })
  }, [reattaching])

  /**
   * The reviewer pointed at a passage in the Preview: take them to it in the
   * Source.
   *
   * A click is not a request to write a Note, so it stops at the selection and
   * the floating **Add note** button — which is also what is wanted when the
   * faster fix is to correct the sentence by hand (`docs/adr/0003`). Nothing
   * moves until the mapping has succeeded: landing on the wrong passage is
   * worse than not moving.
   */
  const onPointedAt = useCallback(
    (message: PreviewGesture) => {
      if (previewSource === undefined || previewKind === null) return

      const located: PreviewLocation = locatedBy(previewKind, previewSource, message)

      if (located.outcome === 'not-found') {
        // Nothing moves, and in particular the view does not change: switching
        // to the Source and only then admitting failure would cost the reviewer
        // the reading position this whole feature exists to protect. For an
        // HTML Draft this is the only way a mapping can fail, so it is the one
        // that has to be inert.
        setMappingNote(UNFINDABLE_TEXT)
        return
      }

      // A selection asks for a Note, so it goes all the way to the composer —
      // a button that says "Add note" should add one, not offer to. A click
      // asks only to be taken there, and stops at the selection and the
      // floating button. A phrase that could not be pinned lands on its block
      // with the button rather than the composer, and says why; that can only
      // happen for a Markdown Draft, since only Markdown has blocks.
      const wantsANote = asksForANote(message)
      const compose = wantsANote && located.outcome !== 'block'
      setMappingNote(wantsANote && located.outcome === 'block' ? AMBIGUOUS_PHRASE : undefined)

      pendingJump.current = { from: located.from, to: located.to, compose }
      // Review-wide, so the next Draft opens in its Source too: "which view am
      // I in" stays one answer rather than one answer with exceptions.
      setPreviewing(false)
    },
    [previewKind, previewSource, setPreviewing],
  )

  /**
   * Switching to the Preview snapshots the buffer for it to render, and starts
   * a write of what has been typed.
   *
   * The flush is what keeps disk saying what the reviewer is looking at, since
   * the server cuts an Anchor out of the file rather than out of the snapshot.
   * A flush that fails does not hold the Preview back — it renders the buffer
   * either way, and a Note written from it then fails exactly as a Note written
   * in the Source view already does.
   *
   * The snapshot is taken here and not behind the flush, because it comes from
   * the buffer and the flush is about disk. Taking it now means the document
   * the Preview is about to render and the block the Source is being read at
   * are settled in the same commit, so the block index the two views trade
   * cannot be an index into a document neither of them is showing.
   */
  useEffect(() => {
    if (!showingPreview) return
    setMappingNote(undefined)
    setComposerOpen(view.current?.state.field(composerField) !== null)
    snapshotForPreview()
    // Taken in the layout effect above, which ran in the commit that hid the
    // Source view and so is the only place the question could still be asked.
    setArrival({ block: arrivingBlock.current })
    void flush()
  }, [showingPreview, flush, snapshotForPreview])

  /**
   * The source view is hidden, never unmounted, while the preview is up. Its
   * CodeMirror state — which threads are open, which one is being edited, an
   * unsaved composer — lives in that view, and rebuilding it would throw all of
   * that away. `visibility` rather than `display` keeps the view laid out, so
   * CodeMirror can still measure and the scroller keeps its offset; the offset
   * is saved and restored anyway rather than relying on that.
   *
   * Where it lands on the way back is a question with three answers, in order
   * of how loudly the reviewer asked for it: an explicit jump from the Preview
   * wins outright; failing that a Markdown Draft goes to the passage the
   * Preview was being read at, worked out fresh from the block ranges; failing
   * that an HTML Draft, which has no block ranges to work anything out from,
   * goes back to its own remembered offset.
   */
  useLayoutEffect(() => {
    const editor = view.current
    const scroller = editor?.scrollDOM
    if (!editor || !scroller) return

    if (showingPreview) {
      arrivingBlock.current = sourceTopBlock()
      // An HTML Draft has no blocks to name a passage with, so its Source view
      // keeps its own offset instead — see `docs/adr/0005`.
      if (!hasBlocks) sourceScrollTop.current = scroller.scrollTop
      return
    }

    const jump = pendingJump.current
    if (jump) {
      pendingJump.current = null
      const from = Math.min(jump.from, editor.state.doc.length)
      const to = Math.min(jump.to, editor.state.doc.length)
      // Selected on arrival, so if the mapping landed somewhere odd the
      // reviewer sees it in the same glance rather than finding it later in the
      // sidecar — and can narrow it before writing anything.
      editor.dispatch({
        selection: EditorSelection.single(from, to),
        effects: [
          EditorView.scrollIntoView(EditorSelection.range(from, to), { y: 'center' }),
          ...(jump.compose ? [openComposer.of({ from, to })] : []),
        ],
      })
      // The composer focuses its own body as it is built, so focus is left
      // alone when one is opening rather than taken back off it.
      if (!jump.compose) editor.focus()
      return
    }

    if (hasBlocks) {
      // The passage the Preview was showing, in the Source's own coordinates.
      // The block goes to the top rather than to the middle, because the top is
      // where the Preview was reporting from: put it anywhere else and each
      // switch would answer a slightly different question from the last one,
      // which is how a reader ends up a paragraph further down the Draft every
      // time they change their mind about which view to read in.
      const block = previewTopBlock.current
      const offset = block === null ? null : offsetOfBlock(previewSourceNow.current ?? '', block)
      const at = Math.min(offset ?? 0, editor.state.doc.length)
      // The selection is left alone: arriving on a passage is not pointing at
      // it, and the Note the reviewer may be about to write is not about the
      // fact that they scrolled here.
      editor.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'start', yMargin: 0 }) })
      return
    }

    scroller.scrollTop = sourceScrollTop.current
    editor.requestMeasure()
  }, [showingPreview, hasBlocks, sourceTopBlock])

  return (
    <div className="flex h-full flex-col">
      {/* A `.txt` Draft gets no toggle. It still gets the bar while preview mode
          is on, so the toggle looks explained rather than missing. */}
      {(previewKind || previewing) && (
        <div className="flex h-9 shrink-0 items-center gap-3 border-b border-[var(--review-border)] px-3">
          {previewKind ? (
            <div
              role="group"
              aria-label="Draft view"
              className="inline-flex overflow-hidden rounded-md border border-[var(--review-border)]"
            >
              <ViewButton active={!showingPreview} onClick={() => setPreviewing(false)}>
                Source
              </ViewButton>
              <ViewButton active={showingPreview} onClick={() => setPreviewing(true)}>
                Preview
              </ViewButton>
            </div>
          ) : (
            <span className="truncate text-[12px] text-[var(--review-dim)]">
              A plain text Draft has no rendered preview.
            </span>
          )}
          {mappingNote ? (
            <span role="status" className="truncate text-[12px] text-[#9a6700]">
              {mappingNote}
            </span>
          ) : (
            showingPreview && (
              <span className="truncate text-[12px] text-[var(--review-dim)]">{PREVIEW_HINT}</span>
            )
          )}
        </div>
      )}

      {conflict && (
        <ConflictBanner draftPath={draft.path} onKeepMine={keepMine} onTakeTheirs={takeTheirs} />
      )}

      {saveError && !conflict && (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-3 border-b border-[#ffc1c0] bg-[#fff8f8] px-3 py-2 text-[12px] text-[#d1242f]"
        >
          <span className="min-w-0 flex-1">
            This Draft could not be written to disk: {saveError}
          </span>
          <button
            type="button"
            onClick={() => void flush()}
            className="shrink-0 rounded-md border border-[#ffc1c0] px-2 py-1 font-medium"
          >
            Try again
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div
          ref={host}
          className="absolute inset-0 overflow-auto"
          style={{ visibility: showingPreview ? 'hidden' : 'visible' }}
          data-testid="draft-pane"
        />
        {/* Mounted on first use and hidden thereafter, never unmounted —
            exactly as the source view is, and for the same reason written down
            beside it: the state lives in the view, and rebuilding throws it
            away. A Draft that is never previewed still costs nothing, because
            the snapshot it renders is only taken when the reviewer asks. */}
        {previewKind !== null && previewSource !== undefined && (
          <div
            className="absolute inset-0"
            style={{ visibility: showingPreview ? 'visible' : 'hidden' }}
          >
            <DraftPreview
              source={previewSource}
              kind={previewKind}
              composerOpen={composerOpen}
              arrival={arrival}
              onReadingBlock={onReadingBlock}
              onPointedAt={onPointedAt}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The one moment editing a Draft is not invisible: the agent rewrote the file
 * while the reviewer had edits of their own in the buffer. Both versions are
 * somebody's work, so the reviewer picks — nothing is overwritten behind them.
 */
function ConflictBanner({
  draftPath,
  onKeepMine,
  onTakeTheirs,
}: {
  draftPath: string
  onKeepMine: () => void
  onTakeTheirs: () => void
}) {
  return (
    <div
      role="alert"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#d4a72c] bg-[#fff8c5] px-3 py-2 text-[12px]"
    >
      <span className="min-w-0 flex-1">
        <strong className="font-semibold">{draftPath} changed on disk</strong> while you had unsaved
        edits. Your edits are still in the pane.
      </span>
      <button
        type="button"
        onClick={onKeepMine}
        className="shrink-0 rounded-md bg-[var(--review-accent)] px-2.5 py-1 font-medium text-white"
      >
        Keep my edits
      </button>
      <button
        type="button"
        onClick={onTakeTheirs}
        className="shrink-0 rounded-md border border-[#d4a72c] px-2.5 py-1 font-medium"
      >
        Take the version on disk
      </button>
    </div>
  )
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`px-2.5 py-1 text-[12px] font-medium ${
        active
          ? 'bg-[var(--review-accent)] text-white'
          : 'bg-[var(--review-surface)] text-[var(--review-dim)] hover:bg-[var(--review-muted)]'
      }`}
    >
      {children}
    </button>
  )
}
