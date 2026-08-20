import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'galley:sidebar-collapsed'

/**
 * On a Mac, CodeMirror's standard keymap binds Ctrl-B to "move the cursor left"
 * — an Emacs habit it keeps on that platform only. Claiming Ctrl-B for the
 * sidebar there would fight the editor on every press, so the shortcut is
 * Cmd-B on a Mac and Ctrl-B everywhere else.
 */
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

export const SIDEBAR_SHORTCUT = MAC ? '⌘B' : 'Ctrl+B'

/**
 * Whether the Draft list is showing.
 *
 * The choice is remembered: it is a preference about how you like to read, not
 * part of reviewing this particular folder, so having it reset on every reload
 * would be its own small annoyance.
 */
export function useCollapsibleSidebar(): { collapsed: boolean; toggle: () => void } {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === 'true'
    } catch {
      // Storage can be unavailable; the sidebar just doesn't remember.
      return false
    }
  })

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next))
      } catch {
        // As above — a preference that can't be saved is not worth failing over.
      }
      return next
    })
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'b' && event.key !== 'B') return
      if (event.altKey || event.shiftKey) return
      if (MAC ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return

      event.preventDefault()
      toggle()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])

  return { collapsed, toggle }
}
