import { StateField, type EditorState, type Extension } from '@codemirror/state'
import { EditorView, showTooltip, type Tooltip, type TooltipView } from '@codemirror/view'
import { flagsField } from '../flags/editor.js'
import { button } from './dom.js'
import {
  composerField,
  notesField,
  openComposer,
  reattachingField,
  setReattaching,
} from './state.js'
import type { NoteHandlers } from './widgets.js'

/**
 * The floating **Add note** and **⚑** buttons, revealed by selecting text in a
 * Draft.
 *
 * The gutter anchors a Note to whole lines, which is too coarse for prose: a
 * Markdown paragraph is often one 400-character line, and the Note is about
 * five words of it. This is a second way into the same composer — it opens with
 * the Anchor set to the selected character range — so the stored Anchor,
 * re-anchoring, and the rest of a Note's life are untouched.
 *
 * The ⚑ beside it raises a Flag on the same range and files it immediately —
 * no composer, no dialog. It stands down while an Orphaned Note is being
 * re-attached, where the whole control means "point that Note here" and a
 * second thing to press would be a trap.
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

  // Saving a Note leaves the selection where it was, so without this the button
  // would sit over the Note the reviewer just wrote, offering to write it again.
  // While re-attaching, though, the button is the whole point.
  const alreadyNoted = state
    .field(notesField)
    .some((note) => note.range?.from === from && note.range.to === to)
  if (alreadyNoted && !state.field(reattachingField)) return null

  return { from, to }
}

/**
 * Whether this exact passage already carries a Flag.
 *
 * The same guard the **Add note** button has against offering to write a Note
 * over one just written: flagging leaves the selection where it was, so without
 * this the ⚑ would sit on the passage it has just flagged, offering to flag it
 * again. The mark under the text says the same thing more quietly.
 */
function alreadyFlagged(state: EditorState, range: { from: number; to: number }): boolean {
  return state
    .field(flagsField)
    .some((flag) => flag.range?.from === range.from && flag.range.to === range.to)
}

/**
 * CodeMirror reuses a tooltip's DOM only while its `create` stays the same
 * function, so this is defined once and reads the selection at click time
 * rather than closing over the range it was built for.
 */
function makeAddNoteButton(handlers: NoteHandlers) {
  return function createAddNoteButton(view: EditorView): TooltipView {
    return addNoteButtonView(view, handlers)
  }
}

function addNoteButtonView(view: EditorView, handlers: NoteHandlers): TooltipView {
  const reattaching = view.state.field(reattachingField)

  const add = button(
    reattaching ? 'Re-attach here' : 'Add note',
    'cm-addNoteToSelection',
    () => {
      const range = anchorableSelection(view.state)
      if (!range) return

      const id = view.state.field(reattachingField)
      if (id) {
        view.dispatch({ effects: setReattaching.of(null) })
        void handlers.reattach(id, range)
        return
      }
      view.dispatch({ effects: openComposer.of(range) })
    },
  )
  add.title = reattaching
    ? 'Point the Orphaned Note at this text'
    : 'Leave a Note on the selected text'

  // Pressing a control outside the text would ordinarily move focus and drop
  // the selection before the click lands — and, once Drafts are editable, move
  // the caret with it. Swallowing the press leaves the selection exactly as the
  // reviewer made it, which is what the Anchor is about to be cut from.
  add.addEventListener('mousedown', (event) => event.preventDefault())

  const range = anchorableSelection(view.state)
  if (reattaching || (range && alreadyFlagged(view.state, range))) {
    return { dom: wrap(add), offset: { x: 0, y: LIFT } }
  }

  const raise = button('\u2691', 'cm-flagSelection', () => {
    const range = anchorableSelection(view.state)
    if (!range) return
    void handlers.flag(range)
  })
  raise.title = 'Flag this passage to come back to (\u2318\u21e7F)'
  raise.addEventListener('mousedown', (event) => event.preventDefault())

  return { dom: wrap(add, raise), offset: { x: 0, y: LIFT } }
}

/**
 * The tooltip element itself, holding one or both buttons.
 *
 * CodeMirror styles the tooltip node, so the buttons cannot be it any more now
 * that there can be two: the wrapper takes the panel styling and the buttons
 * sit inside it.
 */
function wrap(...buttons: HTMLElement[]): HTMLElement {
  const row = document.createElement('div')
  row.className = 'cm-selectionActions'
  row.append(...buttons)
  return row
}

function addNoteTooltip(
  range: { from: number; to: number },
  create: (view: EditorView) => TooltipView,
): Tooltip {
  return {
    pos: range.from,
    end: range.to,
    // Above the selection, so the button never covers the words being judged.
    // CodeMirror drops it below when the selection starts at the top edge.
    above: true,
    create,
  }
}

/**
 * The button follows the selection. Nothing here creates a Note: dismissing the
 * selection just takes the field back to null and the button with it.
 */
function addNoteTooltipField(handlers: NoteHandlers): StateField<Tooltip | null> {
  // Stable per extension instance, so CodeMirror keeps reusing the button's DOM
  // instead of rebuilding it under the pointer on every selection change.
  const create = makeAddNoteButton(handlers)

  return StateField.define<Tooltip | null>({
    create(state) {
      const range = anchorableSelection(state)
      return range ? addNoteTooltip(range, create) : null
    },
    update(current, transaction) {
      const range = anchorableSelection(transaction.state)
      if (!range) return null

      // Rebuilt when the Flags change too: the ⚑ stands down once the passage
      // it is over has been flagged, and the tooltip is reused otherwise.
      const changed =
        transaction.startState.field(reattachingField) !==
          transaction.state.field(reattachingField) ||
        transaction.startState.field(flagsField) !== transaction.state.field(flagsField)
      if (!changed && current && current.pos === range.from && current.end === range.to) {
        return current
      }
      return addNoteTooltip(range, create)
    },
    provide: (field) => showTooltip.from(field),
  })
}

// The button *is* the tooltip element, so CodeMirror's own panel styling and
// this button's styling land on the same node. Everything therefore has to sit
// at the same specificity as `&light .cm-tooltip`, or the panel rules win and
// the button ends up white-on-white with no background at all.
const addNoteButton = {
  display: 'block',
  padding: '3px 8px',
  border: 'none',
  borderRadius: '6px',
  background: '#0969da',
  color: '#fff',
  boxShadow: '0 1px 3px rgba(31, 35, 40, 0.24)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  fontSize: '12px',
  fontWeight: '500',
  lineHeight: '1.4',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
}

const hovered = { background: '#0550ae' }

/** The row is the tooltip, so it carries the panel's own reset. */
const actionRow = {
  display: 'flex',
  gap: '1px',
  border: 'none',
  borderRadius: '6px',
  background: 'transparent',
  boxShadow: '0 1px 3px rgba(31, 35, 40, 0.24)',
  overflow: 'hidden',
}

const flagButton = {
  ...addNoteButton,
  padding: '3px 7px',
  borderRadius: '0',
  fontSize: '13px',
}

const addNoteTooltipTheme = EditorView.baseTheme({
  '&light .cm-tooltip.cm-selectionActions': actionRow,
  '&dark .cm-tooltip.cm-selectionActions': actionRow,
  '&light .cm-tooltip .cm-addNoteToSelection': { ...addNoteButton, borderRadius: '0' },
  '&dark .cm-tooltip .cm-addNoteToSelection': { ...addNoteButton, borderRadius: '0' },
  '&light .cm-tooltip .cm-addNoteToSelection:hover': hovered,
  '&dark .cm-tooltip .cm-addNoteToSelection:hover': hovered,
  '&light .cm-tooltip .cm-flagSelection': flagButton,
  '&dark .cm-tooltip .cm-flagSelection': flagButton,
  '&light .cm-tooltip .cm-flagSelection:hover': hovered,
  '&dark .cm-tooltip .cm-flagSelection:hover': hovered,
})

/** Selecting text in the Draft offers to open the composer over that range. */
export function selectionNoteButton(handlers: NoteHandlers): Extension {
  return [addNoteTooltipField(handlers), addNoteTooltipTheme]
}
