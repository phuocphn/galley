import { StateEffect, StateField, type ChangeDesc } from '@codemirror/state'
import type { ResolvedNote } from '../../shared/types.js'

/**
 * Move a range through a document change.
 *
 * The Draft is editable, so every Anchor in the pane is a range in a document
 * that is moving under it. `docs/adr/0002`: within a session CodeMirror maps
 * every Anchor through the reviewer's keystrokes, and only a reload goes back to
 * matching the stored text. Without this, typing a paragraph above a Note leaves
 * that Note's thread rendered against the wrong sentence.
 *
 * The associations make the range behave the way a highlight should: text typed
 * at either edge lands outside the Anchor, text typed inside it joins it. A
 * deletion that swallows the range collapses it to a point rather than inverting
 * it — the Note is still there, and the next reload is what decides whether the
 * passage is gone for good and the Note Orphaned.
 */
function mapRange(
  range: { from: number; to: number },
  changes: ChangeDesc,
): { from: number; to: number } {
  const from = changes.mapPos(range.from, 1)
  const to = changes.mapPos(range.to, -1)
  return { from, to: Math.max(from, to) }
}

/** Replace the Notes the pane is showing. Dispatched whenever they're refetched. */
export const setNotes = StateEffect.define<ResolvedNote[]>()

/** Open the composer over a range of the Draft. */
export const openComposer = StateEffect.define<{ from: number; to: number }>()

/** Close the composer without saving. */
export const closeComposer = StateEffect.define<null>()

/** Which line the pointer is over in the gutter, if any. */
export const setHoveredLine = StateEffect.define<number | null>()

/** The line range being dragged out in the gutter, if any. */
export const setDraggedLines = StateEffect.define<{ anchor: number; head: number } | null>()

/** Collapse or expand one Note's thread. */
export const toggleCollapsed = StateEffect.define<string>()

/** Put one Note's thread into edit mode, or take it out. */
export const setEditing = StateEffect.define<string | null>()

/**
 * The Orphaned Note the reviewer is re-attaching, if any. While this is set,
 * choosing a range points that Note at new text instead of starting a new one.
 */
export const setReattaching = StateEffect.define<string | null>()

export const notesField = StateField.define<ResolvedNote[]>({
  create: () => [],
  update(notes, transaction) {
    // A fresh set from the server is already located in the document that
    // transaction carries, so it is taken as given rather than mapped.
    for (const effect of transaction.effects) if (effect.is(setNotes)) return effect.value
    if (!transaction.docChanged) return notes

    return notes.map((note) =>
      note.range ? { ...note, range: mapRange(note.range, transaction.changes) } : note,
    )
  },
})

export const composerField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(composer, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(openComposer)) return effect.value
      if (effect.is(closeComposer)) return null
    }
    // An open composer is an Anchor that hasn't been saved yet, and it has to
    // follow the text for the same reason a saved one does.
    if (!composer || !transaction.docChanged) return composer
    return mapRange(composer, transaction.changes)
  },
})

export const hoveredLineField = StateField.define<number | null>({
  create: () => null,
  update(line, transaction) {
    for (const effect of transaction.effects) if (effect.is(setHoveredLine)) return effect.value
    return line
  },
})

export const draggedLinesField = StateField.define<{ anchor: number; head: number } | null>({
  create: () => null,
  update(drag, transaction) {
    for (const effect of transaction.effects) if (effect.is(setDraggedLines)) return effect.value
    return drag
  },
})

export const collapsedField = StateField.define<ReadonlySet<string>>({
  create: () => new Set(),
  update(collapsed, transaction) {
    let next = collapsed
    for (const effect of transaction.effects) {
      if (!effect.is(toggleCollapsed)) continue
      const copy = new Set(next)
      if (copy.has(effect.value)) copy.delete(effect.value)
      else copy.add(effect.value)
      next = copy
    }
    return next
  },
})

export const editingField = StateField.define<string | null>({
  create: () => null,
  update(editing, transaction) {
    for (const effect of transaction.effects) if (effect.is(setEditing)) return effect.value
    return editing
  },
})

export const reattachingField = StateField.define<string | null>({
  create: () => null,
  update(reattaching, transaction) {
    for (const effect of transaction.effects) if (effect.is(setReattaching)) return effect.value
    return reattaching
  },
})

/**
 * Fold a fresh set of Notes from the server into the ones the pane is showing,
 * keeping the Anchors the pane has been mapping.
 *
 * The server locates a Note's Anchor in the file on disk. While the buffer has
 * unsaved edits in it, that file is behind what the reviewer is looking at, so
 * its offsets would drag every thread back to where the text used to be. The
 * Note itself — its body, Status and Replies — is still the server's to tell us.
 */
export function keepingLocalAnchors(
  incoming: ResolvedNote[],
  showing: readonly ResolvedNote[],
): ResolvedNote[] {
  const located = new Map(showing.filter((note) => note.range).map((note) => [note.id, note]))

  return incoming.map((note) => {
    const local = located.get(note.id)
    return local ? { ...note, range: local.range, match: local.match } : note
  })
}

/** The 1-based lines a Note covers in the Draft as it stands, if it was found. */
export function noteLines(
  note: ResolvedNote,
  lineAt: (offset: number) => number,
): { start: number; end: number } | undefined {
  if (!note.range) return undefined
  return {
    start: lineAt(note.range.from),
    end: lineAt(Math.max(note.range.from, note.range.to - 1)),
  }
}
