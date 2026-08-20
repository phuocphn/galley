import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import type { ReviewEvent } from '../shared/types.js'
import { createReviewApp } from './app.js'
import { ReviewEvents } from './events.js'
import { watchReview } from './watcher.js'

const CLIENT_DIRECTORY = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../client')

/** Where clients subscribe to Review changes. */
export const EVENTS_PATH = '/api/events'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

async function readClientFile(pathname: string): Promise<Response | undefined> {
  const absolute = path.resolve(CLIENT_DIRECTORY, `.${pathname}`)
  if (!absolute.startsWith(CLIENT_DIRECTORY)) return undefined

  try {
    const stats = await stat(absolute)
    if (!stats.isFile()) return undefined
  } catch {
    return undefined
  }

  // Client assets are small and local; reading them whole keeps this simple.
  return new Response(await readFile(absolute), {
    headers: { 'content-type': CONTENT_TYPES[path.extname(absolute)] ?? 'application/octet-stream' },
  })
}

/** A running editor: the API, the client, the watcher, and the event socket. */
export interface RunningServer {
  url: string
  port: number
  close(): Promise<void>
}

/**
 * Boot the Review API with the built client in front of it, plus the watcher
 * that tells connected clients when the agent changes something. The client is
 * read from beside this file, not from the working directory, so the CLI works
 * from wherever it's run.
 *
 * Pass port 0 to have one assigned — the tests do this so they can run several
 * at once.
 */
export async function startServer(reviewRoot: string, port: number): Promise<RunningServer> {
  const app = createReviewApp(reviewRoot)
  const events = new ReviewEvents()

  app.get('/*', async (c) => {
    const asset = await readClientFile(c.req.path)
    if (asset) return asset

    // Anything else falls through to the SPA shell.
    const shell = await readClientFile('/index.html')
    if (!shell) return c.text('Client not built. Run `npm run build`.', 500)
    return shell
  })

  const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    const started = serve({ fetch: app.fetch, port }, () => resolve(started))
    started.on('error', reject)
  })

  const address = server.address()
  const boundPort = typeof address === 'object' && address ? address.port : port

  // Changes to the Review are pushed, not polled: the reviewer watches the
  // agent's work land in the window they already have open.
  const sockets = new WebSocketServer({ server: server as never, path: EVENTS_PATH })
  const unsubscribe = events.subscribe((event: ReviewEvent) => {
    const payload = JSON.stringify(event)
    for (const socket of sockets.clients) {
      if (socket.readyState === socket.OPEN) socket.send(payload)
    }
  })

  const watcher = watchReview(reviewRoot, events)

  return {
    url: `http://localhost:${boundPort}`,
    port: boundPort,
    async close() {
      unsubscribe()
      await watcher.close()
      await new Promise<void>((resolve) => sockets.close(() => resolve()))
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
