import { useSyncExternalStore } from 'react'

/**
 * Which view of the Draft the pane is showing.
 *
 * - `source` — the Draft as it is written, in the editor.
 * - `preview` — the Draft as it reads, rendered.
 * - `notes` — every Note on this Draft with nowhere in the text to draw itself:
 *   the ones about the whole Draft, and the ones that have lost their Anchor.
 *
 * This is a property of the Review pass, not of any one Draft: a reviewer who
 * turned the preview on wants the next Draft rendered too, and the same goes
 * for the Notes list. The Draft pane is torn down and rebuilt on every Draft
 * switch, so the choice is held here, above that lifecycle, rather than in the
 * pane's own state. It deliberately does not survive a reload — reopening the
 * Review starts on the Source.
 *
 * A Draft with no rendered preview simply has no Preview tab; the choice falls
 * back to the Source rather than the tab strip disappearing. See
 * `docs/adr/0012`.
 */
export type DraftView = 'source' | 'preview' | 'notes'

let showing: DraftView = 'source'

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setShowing(next: DraftView): void {
  if (next === showing) return
  showing = next
  for (const listener of listeners) listener()
}

/** Read the chosen view, and a setter for the tabs. */
export function useDraftView(): [DraftView, (next: DraftView) => void] {
  return [
    useSyncExternalStore(
      subscribe,
      () => showing,
      () => 'source' as DraftView,
    ),
    setShowing,
  ]
}
