import { useEffect, useRef } from 'react'
import type { ReviewEvent } from '../shared/types.js'

/** Matches `EVENTS_PATH` on the server. */
const EVENTS_PATH = '/api/events'

/** How long to wait before reconnecting after the socket drops. */
const RECONNECT_MS = 1000

/**
 * Listen for changes the agent makes to the Review.
 *
 * The handler is held in a ref rather than in the effect's dependencies, so a
 * re-render doesn't tear the socket down and reconnect on every keystroke.
 */
export function useReviewEvents(onEvent: (event: ReviewEvent) => void): void {
  const handler = useRef(onEvent)
  handler.current = onEvent

  useEffect(() => {
    let socket: WebSocket | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let closed = false

    const connect = (): void => {
      if (closed) return

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(`${protocol}//${window.location.host}${EVENTS_PATH}`)

      socket.addEventListener('message', (message) => {
        handler.current(JSON.parse(String(message.data)) as ReviewEvent)
      })
      socket.addEventListener('close', () => {
        if (!closed) retry = setTimeout(connect, RECONNECT_MS)
      })
    }

    connect()

    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      socket?.close()
    }
  }, [])
}
