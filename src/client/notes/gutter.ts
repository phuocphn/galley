import { type Extension } from '@codemirror/state'
import { EditorView, GutterMarker, ViewPlugin, gutter, lineNumbers } from '@codemirror/view'
import {
  draggedLinesField,
  hoveredLineField,
  noteLines,
  notesField,
  openComposer,
  reattachingField,
  setDraggedLines,
  setHoveredLine,
  setReattaching,
} from './state.js'
import type { NoteHandlers } from './widgets.js'

/** The blue **+** revealed by hovering a line number. */
class AddNoteMarker extends GutterMarker {
  override toDOM(): Node {
    const plus = document.createElement('span')
    plus.className = 'cm-addNote'
    plus.title = 'Leave a Note on this line'
    plus.textContent = '+'
    return plus
  }
}

/** The standing mark on a line that already carries a Note. */
class HasNoteMarker extends GutterMarker {
  override toDOM(): Node {
    const mark = document.createElement('span')
    mark.className = 'cm-hasNote'
    return mark
  }
}

const addNoteMarker = new AddNoteMarker()
const hasNoteMarker = new HasNoteMarker()

function draggedSpan(drag: { anchor: number; head: number }): { start: number; end: number } {
  return { start: Math.min(drag.anchor, drag.head), end: Math.max(drag.anchor, drag.head) }
}

/**
 * Hover and drag are shared by both gutter columns, so that hovering the line
 * number itself reveals the **+** — not just the narrow column it appears in.
 */
const gutterPointerHandlers = {
  mousedown(view: EditorView, block: { from: number }, event: Event) {
    if ((event as MouseEvent).button !== 0) return false
    const line = view.state.doc.lineAt(block.from).number
    view.dispatch({ effects: setDraggedLines.of({ anchor: line, head: line }) })
    event.preventDefault()
    return true
  },
  mousemove(view: EditorView, block: { from: number }) {
    const line = view.state.doc.lineAt(block.from).number
    const drag = view.state.field(draggedLinesField)

    if (drag) {
      if (drag.head === line) return false
      view.dispatch({ effects: setDraggedLines.of({ ...drag, head: line }) })
      return true
    }

    if (view.state.field(hoveredLineField) === line) return false
    view.dispatch({ effects: setHoveredLine.of(line) })
    return true
  },
}

/**
 * The Note gutter: line numbers, a **+** wherever the pointer is (or wherever a
 * drag reaches), and a standing mark on every line a Note covers.
 */
export function noteGutter(handlers: NoteHandlers): Extension {
  return [
    lineNumbers({ domEventHandlers: gutterPointerHandlers }),

    gutter({
      class: 'cm-noteGutter',
      lineMarker(view, block) {
        const state = view.state
        const line = state.doc.lineAt(block.from).number

        const drag = state.field(draggedLinesField)
        if (drag) {
          const span = draggedSpan(drag)
          if (line >= span.start && line <= span.end) return addNoteMarker
        } else if (state.field(hoveredLineField) === line) {
          return addNoteMarker
        }

        const lineAt = (offset: number) => state.doc.lineAt(offset).number
        const covered = state
          .field(notesField)
          .some((note) => {
            const span = noteLines(note, lineAt)
            return span !== undefined && line >= span.start && line <= span.end
          })

        return covered ? hasNoteMarker : null
      },
      lineMarkerChange: (update) =>
        update.startState.field(hoveredLineField) !== update.state.field(hoveredLineField) ||
        update.startState.field(draggedLinesField) !== update.state.field(draggedLinesField) ||
        update.startState.field(notesField) !== update.state.field(notesField),
      initialSpacer: () => addNoteMarker,
      domEventHandlers: gutterPointerHandlers,
    }),

    // The drag ends wherever the pointer happens to be, which is often outside
    // the gutter — so the release is caught on the window, not the gutter.
    ViewPlugin.define((view) => {
      const finishDrag = () => {
        const drag = view.state.field(draggedLinesField)
        if (!drag) return

        const span = draggedSpan(drag)
        const from = view.state.doc.line(span.start).from
        const to = view.state.doc.line(span.end).to

        // While an Orphaned Note is being re-attached, choosing a range points
        // that Note at it rather than starting a new one.
        const reattaching = view.state.field(reattachingField)
        if (reattaching) {
          view.dispatch({ effects: [setDraggedLines.of(null), setReattaching.of(null)] })
          void handlers.reattach(reattaching, { from, to })
          return
        }

        view.dispatch({
          effects: [setDraggedLines.of(null), openComposer.of({ from, to })],
        })
      }

      window.addEventListener('mouseup', finishDrag)
      return { destroy: () => window.removeEventListener('mouseup', finishDrag) }
    }),

    EditorView.domEventHandlers({
      mouseleave(_event, view) {
        if (view.state.field(hoveredLineField) !== null) {
          view.dispatch({ effects: setHoveredLine.of(null) })
        }
        return false
      },
      mousemove(event, view) {
        // Leaving the gutters for the text should drop the **+** again.
        const overGutter = (event.target as Element | null)?.closest?.('.cm-gutters')
        if (!overGutter && view.state.field(hoveredLineField) !== null) {
          view.dispatch({ effects: setHoveredLine.of(null) })
        }
        return false
      },
    }),
  ]
}
