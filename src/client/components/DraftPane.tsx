import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useMemo, useRef } from 'react'
import type { DraftContents, DraftExtension } from '../../shared/types.js'
import { addReply, createNote, deleteNote, resolveNote, updateNote } from '../api.js'
import { notes, setNotes, type NoteHandlers } from '../notes/index.js'
import { closeComposer, setEditing } from '../notes/state.js'

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
  /** Called after a Note is added, edited, or removed. */
  onNotesChanged: () => Promise<void>
}

export function DraftPane({ draft, onNotesChanged }: DraftPaneProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)

  // The extension is built once per view, so it reads the current callbacks
  // through a ref rather than closing over the render that created it.
  const latest = useRef({ draftPath: draft.path, onNotesChanged })
  latest.current = { draftPath: draft.path, onNotesChanged }

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

  return <div ref={host} className="h-full overflow-auto" data-testid="draft-pane" />
}
