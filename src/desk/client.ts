import { spawn } from 'node:child_process'
import { open as openFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { deskLogFile, ensureGalleyHome } from './home.js'
import type { OpenedReview } from './desk.js'
import { GALLEY_VERSION } from './version.js'

/** How long to wait for a freshly spawned Desk to answer. */
const STARTUP_TIMEOUT_MS = 10_000
const POLL_MS = 50

/** What a Desk says about itself. */
export interface DeskHealth {
  galley: true
  version: string
  reviews: OpenedReview[]
}

export class NoDesk extends Error {}
export class NotGalley extends Error {}

const deskEntry = (): string => fileURLToPath(new URL('./main.js', import.meta.url))

/**
 * Ask whoever is on this port what they are.
 *
 * This is the only thing the CLI trusts about what is running: a state file
 * would be a second answer to the same question, and the wrong one after any
 * `kill -9`.
 */
export async function health(port: number): Promise<DeskHealth> {
  let response: Response
  try {
    response = await fetch(`http://localhost:${port}/api/desk`, {
      headers: { accept: 'application/json' },
    })
  } catch {
    throw new NoDesk(`nothing is listening on ${port}`)
  }

  const body = (await response.json().catch(() => undefined)) as DeskHealth | undefined
  if (!response.ok || body?.galley !== true) {
    throw new NotGalley(`something that isn't galley is listening on ${port}`)
  }
  return body
}

/** Ask a Desk to stop, and wait until the port is free. */
export async function stopDesk(port: number): Promise<number> {
  const running = await health(port)
  await fetch(`http://localhost:${port}/api/desk/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })

  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      await health(port)
    } catch {
      return running.reviews.length
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  throw new Error(`the Desk on ${port} would not stop`)
}

/**
 * Start a Desk and wait for it to answer.
 *
 * Two `galley` commands at once will both find nothing listening and both spawn
 * a Desk; one wins the port and the other exits. That is why a spawned Desk
 * dying is not an error here — what matters is that *a* Desk is answering by
 * the time we give up, not that it was ours.
 */
export async function spawnDesk(port: number): Promise<DeskHealth> {
  await ensureGalleyHome()

  // Truncated per Desk, so what is in it is always about the Desk now running.
  const log = await openFile(deskLogFile(), 'w')
  const child = spawn(process.execPath, [deskEntry(), '--port', String(port)], {
    detached: true,
    stdio: ['ignore', log.fd, log.fd],
  })
  child.unref()

  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  try {
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      try {
        return await health(port)
      } catch (cause) {
        if (cause instanceof NotGalley) throw cause
      }
    }
  } finally {
    await log.close()
  }

  throw new Error(`the Desk didn't start — see ${deskLogFile()}`)
}

/** Put a folder on the Desk, and get back where to read it. */
export async function openReview(port: number, root: string): Promise<OpenedReview> {
  const response = await fetch(`http://localhost:${port}/api/reviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ root }),
  })

  const body = (await response.json().catch(() => undefined)) as
    | (OpenedReview & { error?: string })
    | undefined
  if (!response.ok || !body?.url) {
    throw new Error(body?.error ?? `the Desk refused the Review: ${response.status}`)
  }
  return body
}

/** Whether the Desk on this port is running the same build as this CLI. */
export function sameBuild(running: DeskHealth): boolean {
  return running.version === GALLEY_VERSION
}
