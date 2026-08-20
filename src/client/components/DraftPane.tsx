import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
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
import { closeComposer, setEditing, setReattaching } from '../notes/state.js'
import { previewKindFor } from '../preview/document.js'
import { usePreviewMode } from '../preview/mode.js'
import { DraftPreview } from './DraftPreview.js'

/**
 * How long the reviewer has to stop typing before the Draft is written.
 *
 * Long enough that a sentence is one write rather than forty; short enough that
 * an agent started straight after typing sees the edit. There is no save button
 * — see `docs/adr/0003` — so this delay is the whole of the save interface.
 */
const AUTOSAVE_IDLE_MS = 500

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
  /** Where the source view was scrolled to when the preview took the pane. */
  const sourceScrollTop = useRef(0)

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
      async create(range, body) {
        // The server cuts the Anchor out of the file on disk, so the file has to
        // be saying what the reviewer is looking at before the Note is written.
        // While a conflict is unanswered nothing may be written, so the Anchor
        // would be cut from the wrong text — the composer says so instead.
        if (conflicted.current) {
          throw new Error('This Draft changed on disk. Settle that first, then leave the Note.')
        }
        await flush()
        await createNote({ draftPath: latest.current.draftPath, ...range, body })
        view.current?.dispatch({ effects: closeComposer.of(null) })
        await latest.current.onNotesChanged()
      },
      async update(id, body) {
        await updateNote(id, body)
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
    // A remembered scroll offset belongs to the Draft it was taken from.
    sourceScrollTop.current = 0

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
      return
    }

    // Both sides have written. Neither version is ours to throw away.
    stopIdleTimer()
    setConflict({ content: draft.content, notes: draft.notes })
  }, [draft.content, draft.notes, stopIdleTimer])

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
    // Dispatched while the conflict still stands, so autosave stays out of it.
    stopIdleTimer()
    setConflict(undefined)
  }, [conflict, stopIdleTimer])

  useEffect(() => {
    view.current?.dispatch({ effects: setReattaching.of(reattaching ?? null) })
  }, [reattaching])

  /**
   * The source view is hidden, never unmounted, while the preview is up. Its
   * CodeMirror state — which threads are open, which one is being edited, an
   * unsaved composer — lives in that view, and rebuilding it would throw all of
   * that away. `visibility` rather than `display` keeps the view laid out, so
   * CodeMirror can still measure and the scroller keeps its offset; the offset
   * is saved and restored anyway rather than relying on that.
   */
  useLayoutEffect(() => {
    const scroller = view.current?.scrollDOM
    if (!scroller) return
    if (showingPreview) {
      sourceScrollTop.current = scroller.scrollTop
      return
    }
    scroller.scrollTop = sourceScrollTop.current
    view.current?.requestMeasure()
  }, [showingPreview])

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
          {showingPreview && (
            <span className="truncate text-[12px] text-[var(--review-dim)]">
              Rendered preview — read-only. Notes are written in the source view.
            </span>
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
        {showingPreview && (
          <div className="absolute inset-0">
            <DraftPreview content={draft.content} kind={previewKind} />
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
