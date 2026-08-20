import { StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { noteGutter } from './gutter.js'
import {
  collapsedField,
  composerField,
  draggedLinesField,
  editingField,
  hoveredLineField,
  notesField,
} from './state.js'
import { ComposerWidget, ThreadWidget, type NoteHandlers } from './widgets.js'

export { setNotes } from './state.js'
export type { NoteHandlers } from './widgets.js'

/** Block widgets sit at the end of the line the range finishes on. */
function blockPositionFor(state: EditorState, from: number, to: number): number {
  return state.doc.lineAt(Math.max(from, to - 1)).to
}

function buildDecorations(state: EditorState, handlers: NoteHandlers): DecorationSet {
  const collapsed = state.field(collapsedField)
  const editing = state.field(editingField)

  const placed: { position: number; decoration: Decoration }[] = []

  for (const note of state.field(notesField)) {
    if (!note.range) continue
    placed.push({
      position: blockPositionFor(state, note.range.from, note.range.to),
      decoration: Decoration.widget({
        widget: new ThreadWidget(note, collapsed.has(note.id), editing === note.id, handlers),
        block: true,
        side: 1,
      }),
    })
  }

  const composer = state.field(composerField)
  if (composer) {
    placed.push({
      position: blockPositionFor(state, composer.from, composer.to),
      decoration: Decoration.widget({
        widget: new ComposerWidget(composer.from, composer.to, handlers),
        block: true,
        // Sits below any existing threads on the same line.
        side: 2,
      }),
    })
  }

  placed.sort((a, b) => a.position - b.position)
  return Decoration.set(
    placed.map(({ position, decoration }) => decoration.range(position)),
    true,
  )
}

/**
 * Notes in the Draft pane: the gutter that creates them, and the inline threads
 * that show them beneath the text they are about.
 */
export function notes(handlers: NoteHandlers): Extension {
  const decorations = StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, handlers),
    update: (_value, transaction) => buildDecorations(transaction.state, handlers),
    provide: (field) => EditorView.decorations.from(field),
  })

  return [
    notesField,
    composerField,
    hoveredLineField,
    draggedLinesField,
    collapsedField,
    editingField,
    decorations,
    noteGutter(),
  ]
}
