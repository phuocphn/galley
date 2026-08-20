import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ReviewEvent } from '../../src/shared/types.js'
import { EVENTS_PATH, startServer } from '../../src/server/serve.js'

/**
 * A Review served by a real listening server, for the parts of the contract
 * that only exist over a socket. Everything else is tested against the in-process
 * app in `review-fixture.ts`, which is faster.
 */
export interface LiveReview {
  root: string
  url: string
  /** Write a file into the Review, as an agent working outside the editor would. */
  write(relativePath: string, contents: string): Promise<void>
  /** Wait for the next pushed event matching `predicate`, or reject on timeout. */
  nextEvent(predicate: (event: ReviewEvent) => boolean, timeoutMs?: number): Promise<ReviewEvent>
  close(): Promise<void>
}

export async function startLiveReview(
  files: Record<string, string> = {},
): Promise<LiveReview> {
  const root = await mkdtemp(path.join(tmpdir(), 'ai-feedback-live-'))

  const write = async (relativePath: string, contents: string): Promise<void> => {
    const absolute = path.join(root, relativePath)
    await mkdir(path.dirname(absolute), { recursive: true })
    await writeFile(absolute, contents, 'utf8')
  }
  for (const [relativePath, contents] of Object.entries(files)) {
    await write(relativePath, contents)
  }

  const server = await startServer(root, 0)

  // Events that arrive before a test starts listening still count — otherwise
  // every test would race the watcher.
  const received: ReviewEvent[] = []
  const waiting: { predicate: (event: ReviewEvent) => boolean; settle: (e: ReviewEvent) => void }[] =
    []

  const socket = new WebSocket(`ws://localhost:${server.port}${EVENTS_PATH}`)
  socket.addEventListener('message', (message) => {
    const event = JSON.parse(String(message.data)) as ReviewEvent
    const index = waiting.findIndex((waiter) => waiter.predicate(event))
    if (index === -1) {
      received.push(event)
      return
    }
    waiting.splice(index, 1)[0]!.settle(event)
  })

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('Could not open the event socket')), {
      once: true,
    })
  })

  return {
    root,
    url: server.url,
    write,
    nextEvent(predicate, timeoutMs = 4000) {
      const already = received.findIndex(predicate)
      if (already !== -1) return Promise.resolve(received.splice(already, 1)[0]!)

      return new Promise<ReviewEvent>((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiting.findIndex((waiter) => waiter.settle === settle)
          if (index !== -1) waiting.splice(index, 1)
          reject(new Error(`No matching event within ${timeoutMs}ms. Saw: ${JSON.stringify(received)}`))
        }, timeoutMs)

        const settle = (event: ReviewEvent): void => {
          clearTimeout(timer)
          resolve(event)
        }
        waiting.push({ predicate, settle })
      })
    },
    async close() {
      socket.close()
      await server.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}
