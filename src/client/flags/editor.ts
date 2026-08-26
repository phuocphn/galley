import { StateEffect, StateField, type ChangeDesc, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import type { LocatedFlag } from '../../shared/types.js'

/**
 * Flags in the Source view.
 *
 * A Flag is not a Note and does not get a Note's apparatus: no thread, no
 * composer, no gutter **+** of its own. What it gets is enough to be seen while
 * reading — a mark under the passage and a ⚑ beside the line — so that a
 * passage already flagged looks different from one that is not, and the
 * reviewer does not flag the same sentence twice without noticing. Everything
 * you can *do* with a Flag is in the sidebar list. See `docs/adr/0010`.
 */

/** Replace the Flags the pane is showing. Dispatched whenever they're refetched. */
export const setFlags = StateEffect.define<LocatedFlag[]>()

/**
 * Move a range through a document change, exactly as a Note's Anchor moves —
 * the Draft is editable, and a Flag on a passage has to follow that passage
 * while the reviewer types above it.
 */
function mapRange(
  range: { from: number; to: number },
  changes: ChangeDesc,
): { from: number; to: number } {
  const from = changes.mapPos(range.from, 1)
  const to = changes.mapPos(range.to, -1)
  return { from, to: Math.max(from, to) }
}

export const flagsField = StateField.define<LocatedFlag[]>({
  create: () => [],
  update(flags, transaction) {
    for (const effect of transaction.effects) if (effect.is(setFlags)) return effect.value
    if (!transaction.docChanged) return flags

    return flags.map((flag) =>
      flag.range ? { ...flag, range: mapRange(flag.range, transaction.changes) } : flag,
    )
  },
})

/**
 * A dotted underline rather than a tint.
 *
 * A Note's Anchor is a filled block of colour; a Flag is a line under the
 * words. The two sit in the same Draft and often on the same sentence, so they
 * are told apart by shape and not only by hue: "I have asked for this to
 * change" should not look like "I want to look at this again".
 */
const flagMark = Decoration.mark({ class: 'cm-flagAnchor' })

function buildDecorations(flags: readonly LocatedFlag[]): DecorationSet {
  const placed = flags
    .filter((flag) => flag.range && flag.range.to > flag.range.from)
    .map((flag) => flagMark.range(flag.range!.from, flag.range!.to))

  return Decoration.set(placed, true)
}

const flagTheme = EditorView.baseTheme({
  '.cm-flagAnchor': {
    textDecoration: 'underline dotted',
    textDecorationColor: 'rgba(154, 103, 0, 0.85)',
    textDecorationThickness: '2px',
    textUnderlineOffset: '3px',
  },
})

/** The 1-based lines a Flag covers in the Draft as it stands, if it was found. */
export function flagLines(
  flag: LocatedFlag,
  lineAt: (offset: number) => number,
): { start: number; end: number } | undefined {
  if (!flag.range) return undefined
  return {
    start: lineAt(flag.range.from),
    end: lineAt(Math.max(flag.range.from, flag.range.to - 1)),
  }
}

/**
 * Fold a fresh set of Flags from the server into the ones the pane is showing,
 * keeping the ranges the pane has been mapping — the same reason Notes do it:
 * while the buffer has unsaved edits, the server's offsets are cut from text
 * that is behind what the reviewer is looking at.
 */
export function keepingLocalFlagRanges(
  incoming: LocatedFlag[],
  showing: readonly LocatedFlag[],
): LocatedFlag[] {
  const located = new Map(showing.filter((flag) => flag.range).map((flag) => [flag.id, flag]))

  return incoming.map((flag) => {
    const local = located.get(flag.id)
    return local ? { ...flag, range: local.range, match: local.match } : flag
  })
}

/** The Flag layer: where they are, and what they look like under the text. */
export function flagAnchors(): Extension {
  const decorations = StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state.field(flagsField)),
    update: (_value, transaction) => buildDecorations(transaction.state.field(flagsField)),
    provide: (field) => EditorView.decorations.from(field),
  })

  return [flagsField, decorations, flagTheme]
}
