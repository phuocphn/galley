import { useSyncExternalStore } from 'react'

/**
 * Whether the Draft pane is showing rendered previews.
 *
 * This is a property of the Review pass, not of any one Draft: a reviewer who
 * turned the preview on wants the next Draft rendered too. The Draft pane is
 * torn down and rebuilt on every Draft switch, so the flag is held here, above
 * that lifecycle, rather than in the pane's own state. It deliberately does not
 * survive a reload — reopening the Review starts on the source.
 */
let previewing = false

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setPreviewing(next: boolean): void {
  if (next === previewing) return
  previewing = next
  for (const listener of listeners) listener()
}

/** Read the preview flag, and a setter for the toggle. */
export function usePreviewMode(): [boolean, (next: boolean) => void] {
  return [
    useSyncExternalStore(
      subscribe,
      () => previewing,
      () => false,
    ),
    setPreviewing,
  ]
}
