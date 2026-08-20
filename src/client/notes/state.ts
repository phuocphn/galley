import { StateEffect, StateField } from '@codemirror/state'
import type { ResolvedNote } from '../../shared/types.js'

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
    for (const effect of transaction.effects) if (effect.is(setNotes)) return effect.value
    return notes
  },
})

export const composerField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(composer, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(openComposer)) return effect.value
      if (effect.is(closeComposer)) return null
    }
    return composer
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
