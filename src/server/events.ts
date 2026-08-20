import type { ReviewEvent } from '../shared/types.js'

type Listener = (event: ReviewEvent) => void

/**
 * A fan-out point for changes to the Review. The watcher pushes into it and
 * every connected client gets told, which is what lets the reviewer see the
 * agent's work land without refreshing.
 */
export class ReviewEvents {
  private readonly listeners = new Set<Listener>()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: ReviewEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
