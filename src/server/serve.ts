import { EVENTS_SUFFIX, startDesk, type Desk } from '../desk/desk.js'
import { reviewPath } from '../desk/address.js'

/** A Desk holding exactly one Review: the API, the client, and the event socket. */
export interface RunningServer {
  /** The Review's own URL, under the Desk that is holding it. */
  url: string
  port: number
  /** Where this Review's clients subscribe to its changes. */
  eventsPath: string
  close(): Promise<void>
}

/**
 * Boot a Desk and put one Review on it.
 *
 * The Desk is what actually serves (`docs/adr/0008`); this is the one-Review
 * shape of it, which is what the tests drive and what `dev:server` runs.
 *
 * Pass port 0 to have one assigned — the tests do this so they can run several
 * at once.
 */
export async function startServer(reviewRoot: string, port: number): Promise<RunningServer> {
  let desk: Desk | undefined
  try {
    desk = await startDesk({ port })
    const review = await desk.open(reviewRoot)

    return {
      url: review.url,
      port: desk.port,
      eventsPath: `${reviewPath(review.id)}${EVENTS_SUFFIX}`,
      close: () => desk!.close(),
    }
  } catch (cause) {
    await desk?.close()
    throw cause
  }
}
