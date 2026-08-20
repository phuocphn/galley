import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { DraftContents, DraftExtension } from '../../shared/types.js'
import {
  addReply,
  createNote,
  deleteNote,
  reanchorNote,
  resolveNote,
  updateNote,
} from '../api.js'
import { notes, setNotes, type NoteHandlers } from '../notes/index.js'
import { closeComposer, setEditing, setReattaching } from '../notes/state.js'
import { previewKindFor } from '../preview/document.js'
import { usePreviewMode } from '../preview/mode.js'
import { DraftPreview } from './DraftPreview.js'

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

  const handlers = useMemo<NoteHandlers>(
    () => ({
      async create(range, body) {
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
        await reanchorNote(id, range)
        latest.current.onReattached()
        await latest.current.onNotesChanged()
      },
    }),
    [],
  )

  useEffect(() => {
    if (!host.current) return

    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: draft.content,
        extensions: [
          EditorView.lineWrapping,
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          ...languageFor(draft.extension),
          notes(handlers),
          // Drafts become editable in a later slice; for now, read-only.
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ],
      }),
    })
    view.current = editor
    editor.dispatch({ effects: setNotes.of(draft.notes) })
    // A remembered scroll offset belongs to the Draft it was taken from.
    sourceScrollTop.current = 0

    return () => {
      editor.destroy()
      view.current = null
    }
    // Rebuilt only when the Draft itself changes; Notes arrive as an effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.path, draft.extension, draft.content, handlers])

  useEffect(() => {
    view.current?.dispatch({ effects: setNotes.of(draft.notes) })
  }, [draft.notes])

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
