import { StateField, type EditorState, type Extension } from '@codemirror/state'
import { EditorView, showTooltip, type Tooltip, type TooltipView } from '@codemirror/view'
import { button } from './dom.js'
import { composerField, openComposer } from './state.js'

/**
 * The floating **Add note** button, revealed by selecting text in a Draft.
 *
 * The gutter anchors a Note to whole lines, which is too coarse for prose: a
 * Markdown paragraph is often one 400-character line, and the Note is about
 * five words of it. This is a second way into the same composer — it opens with
 * the Anchor set to the selected character range — so the stored Anchor,
 * re-anchoring, and the rest of a Note's life are untouched.
 */

/** How far the button floats clear of the text it belongs to. */
const LIFT = 4

/** A selection worth anchoring a Note to, or null if there isn't one. */
function anchorableSelection(state: EditorState): { from: number; to: number } | null {
  // The gutter and the selection share one composer, so the button stands down
  // while a composer is already open rather than replacing it mid-sentence.
  if (state.field(composerField)) return null

  const { from, to } = state.selection.main
  if (from === to) return null
  // Whitespace alone would anchor to every gap in the Draft, and re-anchoring
  // would have nothing to tell those gaps apart by.
  if (state.sliceDoc(from, to).trim() === '') return null

  return { from, to }
}

/**
 * CodeMirror reuses a tooltip's DOM only while its `create` stays the same
 * function, so this is defined once and reads the selection at click time
 * rather than closing over the range it was built for.
 */
function createAddNoteButton(view: EditorView): TooltipView {
  const add = button('Add note', 'cm-addNoteToSelection', () => {
    const range = anchorableSelection(view.state)
    if (!range) return
    view.dispatch({ effects: openComposer.of(range) })
  })
  add.title = 'Leave a Note on the selected text'

  // Pressing a control outside the text would ordinarily move focus and drop
  // the selection before the click lands — and, once Drafts are editable, move
  // the caret with it. Swallowing the press leaves the selection exactly as the
  // reviewer made it, which is what the Anchor is about to be cut from.
  add.addEventListener('mousedown', (event) => event.preventDefault())

  return { dom: add, offset: { x: 0, y: LIFT } }
}

function addNoteTooltip(range: { from: number; to: number }): Tooltip {
  return {
    pos: range.from,
    end: range.to,
    // Above the selection, so the button never covers the words being judged.
    // CodeMirror drops it below when the selection starts at the top edge.
    above: true,
    create: createAddNoteButton,
  }
}

/**
 * The button follows the selection. Nothing here creates a Note: dismissing the
 * selection just takes the field back to null and the button with it.
 */
const addNoteTooltipField = StateField.define<Tooltip | null>({
  create(state) {
    const range = anchorableSelection(state)
    return range ? addNoteTooltip(range) : null
  },
  update(current, transaction) {
    const range = anchorableSelection(transaction.state)
    if (!range) return null
    if (current && current.pos === range.from && current.end === range.to) return current
    return addNoteTooltip(range)
  },
  provide: (field) => showTooltip.from(field),
})

// The tooltip machinery paints a bordered panel by default, which is wrong for
// a single button. The extra class on the selector out-specifies that.
const bareTooltip = {
  padding: '0',
  border: 'none',
  borderRadius: '6px',
  background: 'none',
  boxShadow: '0 1px 3px rgba(31, 35, 40, 0.24)',
}

const addNoteTooltipTheme = EditorView.baseTheme({
  '&light .cm-tooltip.cm-addNoteToSelection': bareTooltip,
  '&dark .cm-tooltip.cm-addNoteToSelection': bareTooltip,

  '.cm-addNoteToSelection': {
    display: 'block',
    padding: '3px 8px',
    background: '#0969da',
    color: '#fff',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    fontSize: '12px',
    fontWeight: '500',
    lineHeight: '1.4',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },

  '.cm-addNoteToSelection:hover': {
    background: '#0550ae',
  },
})

/** Selecting text in the Draft offers to open the composer over that range. */
export function selectionNoteButton(): Extension {
  return [addNoteTooltipField, addNoteTooltipTheme]
}
