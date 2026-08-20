import { StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { noteGutter } from './gutter.js'
import { selectionNoteButton } from './selection.js'
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

/**
 * The Anchor itself, tinted under the text. A phrase-level Anchor is otherwise
 * invisible — the thread below the line says nothing about which five words of
 * it the Note is aimed at.
 */
const anchorMark = Decoration.mark({ class: 'cm-noteAnchor' })

/** The range the open composer is about to become a Note on. */
const composingAnchorMark = Decoration.mark({
  class: 'cm-noteAnchor cm-noteAnchor--composing',
})

/** Block widgets sit at the end of the line the range finishes on. */
function blockPositionFor(state: EditorState, from: number, to: number): number {
  return state.doc.lineAt(Math.max(from, to - 1)).to
}

function buildDecorations(state: EditorState, handlers: NoteHandlers): DecorationSet {
  const collapsed = state.field(collapsedField)
  const editing = state.field(editingField)

  const placed: { from: number; to: number; decoration: Decoration }[] = []

  /** An empty mark is not a legal decoration, and would show nothing anyway. */
  const mark = (from: number, to: number, decoration: Decoration) => {
    if (to > from) placed.push({ from, to, decoration })
  }
  const widget = (position: number, decoration: Decoration) => {
    placed.push({ from: position, to: position, decoration })
  }

  for (const note of state.field(notesField)) {
    if (!note.range) continue

    // Only while the thread is open, so a Draft carrying many collapsed Notes
    // still reads as prose rather than as a highlighter accident.
    if (!collapsed.has(note.id)) mark(note.range.from, note.range.to, anchorMark)

    widget(
      blockPositionFor(state, note.range.from, note.range.to),
      Decoration.widget({
        widget: new ThreadWidget(note, collapsed.has(note.id), editing === note.id, handlers),
        block: true,
        side: 1,
      }),
    )
  }

  const composer = state.field(composerField)
  if (composer) {
    mark(composer.from, composer.to, composingAnchorMark)
    widget(
      blockPositionFor(state, composer.from, composer.to),
      Decoration.widget({
        widget: new ComposerWidget(composer.from, composer.to, handlers),
        block: true,
        // Sits below any existing threads on the same line.
        side: 2,
      }),
    )
  }

  // Marks and block widgets share the set, so leave the ordering to CodeMirror
  // rather than sorting on `from` alone.
  return Decoration.set(
    placed.map(({ from, to, decoration }) => decoration.range(from, to)),
    true,
  )
}

const anchorTheme = EditorView.baseTheme({
  '.cm-noteAnchor': {
    borderRadius: '2px',
    backgroundColor: 'rgba(191, 135, 0, 0.22)',
    boxShadow: 'inset 0 -1px 0 rgba(191, 135, 0, 0.55)',
  },
  '.cm-noteAnchor--composing': {
    backgroundColor: 'rgba(9, 105, 218, 0.16)',
    boxShadow: 'inset 0 -1px 0 rgba(9, 105, 218, 0.6)',
  },
})

/**
 * Notes in the Draft pane: the two ways of creating one — the gutter, for whole
 * lines, and a text selection, for a phrase — plus the inline threads that show
 * them beneath the text they are about.
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
    anchorTheme,
    noteGutter(),
    selectionNoteButton(),
  ]
}
