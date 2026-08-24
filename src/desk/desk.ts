import { stat } from 'node:fs/promises'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import type { FSWatcher } from 'chokidar'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ReviewEvent } from '../shared/types.js'
import { createReviewApp } from '../server/app.js'
import { ReviewEvents } from '../server/events.js'
import { watchReview } from '../server/watcher.js'
import { canonicalRoot, REVIEW_PREFIX, reviewId, reviewPath } from './address.js'
import { clientShell, readClientFile } from './assets.js'
import { isLoopbackHost, loopbackOnly } from './guards.js'
import { indexPage, type IndexEntry } from './index-page.js'
import { readRegistry, recall, remember } from './registry.js'
import { GALLEY_VERSION } from './version.js'

/** The port a Desk takes unless told otherwise. */
export const DEFAULT_PORT = 4317

/** How long a Review stays open with nobody looking at it. */
export const REVIEW_IDLE_MS = 30 * 60 * 1000

/**
 * How long the Desk lingers after its last Review closes. Long enough that
 * closing a tab and changing your mind doesn't pay for a fresh Desk.
 */
export const DESK_GRACE_MS = 2 * 60 * 1000

/** Where a Review's clients subscribe to its changes, under its own path. */
export const EVENTS_SUFFIX = '/api/events'

/** One Review the Desk is holding open. */
interface Held {
  id: string
  root: string
  app: Hono
  events: ReviewEvents
  watcher: FSWatcher
  clients: Set<WebSocket>
  unsubscribe: () => void
  idle?: ReturnType<typeof setTimeout>
}

/** A Review, as the CLI and the index need to talk about it. */
export interface OpenedReview {
  id: string
  root: string
  /** The Review's URL — derived from its folder, so it is the same every time. */
  url: string
}

export interface DeskOptions {
  port?: number
  reviewIdleMs?: number
  deskGraceMs?: number
  /** Called once the Desk has closed itself for want of anything to hold. */
  onStopped?: () => void
}

/** A running Desk: every Review, the client in front of them, and their sockets. */
export interface Desk {
  port: number
  /** The Desk's own root URL — the index of what it is holding. */
  url: string
  open(folder: string): Promise<OpenedReview>
  reviews(): OpenedReview[]
  close(): Promise<void>
}

export class NotAFolder extends Error {}

/** Split `/r/some-review-a1b2/api/review` into its id and the rest. */
function splitReviewPath(pathname: string): { id: string; rest: string } | undefined {
  if (!pathname.startsWith(`${REVIEW_PREFIX}/`)) return undefined

  const remainder = pathname.slice(REVIEW_PREFIX.length + 1)
  const slash = remainder.indexOf('/')
  if (slash === -1) return { id: remainder, rest: '/' }
  return { id: remainder.slice(0, slash), rest: remainder.slice(slash) }
}

/**
 * Start the Desk: one process holding every Review, each under its own path
 * (`docs/adr/0008`).
 *
 * Pass port 0 to have one assigned — the tests do this so they can run several
 * Desks at once.
 */
export async function startDesk(options: DeskOptions = {}): Promise<Desk> {
  const reviewIdleMs = options.reviewIdleMs ?? REVIEW_IDLE_MS
  const deskGraceMs = options.deskGraceMs ?? DESK_GRACE_MS

  const held = new Map<string, Held>()
  const bound = { port: options.port ?? DEFAULT_PORT }
  let grace: ReturnType<typeof setTimeout> | undefined
  let stopping: Promise<void> | undefined

  const urlOf = (id: string): string => `http://localhost:${bound.port}${reviewPath(id)}`
  const described = (review: Held): OpenedReview => ({
    id: review.id,
    root: review.root,
    url: urlOf(review.id),
  })

  // ---- holding and letting go -------------------------------------------

  function closeReview(id: string): void {
    const review = held.get(id)
    if (!review) return

    clearTimeout(review.idle)
    held.delete(id)
    review.unsubscribe()
    void review.watcher.close()
    for (const socket of review.clients) socket.close()

    // Nothing lost by closing: the Notes are in the sidecar, and the located
    // Anchors a Review accumulates are only a cache.
    considerStopping()
  }

  /** Restart a Review's clock. Only a Review nobody is watching runs one. */
  function touch(review: Held): void {
    clearTimeout(review.idle)
    if (review.clients.size > 0) return
    review.idle = setTimeout(() => closeReview(review.id), reviewIdleMs)
  }

  function considerStopping(): void {
    clearTimeout(grace)
    if (held.size > 0) return
    grace = setTimeout(() => {
      void close().then(() => options.onStopped?.())
    }, deskGraceMs)
  }

  async function open(folder: string): Promise<OpenedReview> {
    const root = await canonicalRoot(folder)
    try {
      if (!(await stat(root)).isDirectory()) throw new NotAFolder(`not a folder: ${root}`)
    } catch (cause) {
      if (cause instanceof NotAFolder) throw cause
      throw new NotAFolder(`no such folder: ${root}`)
    }

    const id = reviewId(root)
    const existing = held.get(id)
    if (existing) {
      touch(existing)
      return described(existing)
    }

    const events = new ReviewEvents()
    const review: Held = {
      id,
      root,
      app: createReviewApp(root),
      events,
      watcher: watchReview(root, events),
      clients: new Set(),
      unsubscribe: events.subscribe((event: ReviewEvent) => {
        const payload = JSON.stringify(event)
        for (const socket of review.clients) {
          if (socket.readyState === socket.OPEN) socket.send(payload)
        }
      }),
    }

    held.set(id, review)
    clearTimeout(grace)
    touch(review)

    // Remembered before it is served, so a bookmark outlives the Desk that
    // first minted it — the id is a hash and cannot be read backwards.
    await remember(id, root)
    return described(review)
  }

  /** Open a Review the Desk isn't holding, if the registry knows what it was. */
  async function reopen(id: string): Promise<Held | undefined> {
    const known = held.get(id)
    if (known) return known

    const root = await recall(id)
    if (!root) return undefined

    try {
      await open(root)
    } catch {
      return undefined
    }
    return held.get(id)
  }

  // ---- the Desk's own routes --------------------------------------------

  const app = new Hono()
  // The guard needs the port that was actually bound, which isn't known until
  // `serve` returns, so it reads it back at request time.
  app.use('*', loopbackOnly(() => bound.port))

  app.get('/', async (c) => {
    const open = [...held.values()].map((review) => ({
      id: review.id,
      root: review.root,
      open: true,
    }))
    const remembered = (await readRegistry())
      .filter((entry) => !held.has(entry.id))
      .map((entry) => ({ id: entry.id, root: entry.root, open: false }))

    const entries: IndexEntry[] = [...open, ...remembered]
    return c.html(indexPage(entries))
  })

  app.get('/api/desk', (c) =>
    c.json({
      galley: true,
      version: GALLEY_VERSION,
      reviews: [...held.values()].map(described),
    }),
  )

  app.post('/api/desk/stop', (c) => {
    // Answered before it acts, so the CLI hears back rather than losing the
    // socket to its own request.
    setTimeout(() => void close().then(() => options.onStopped?.()), 10)
    return c.json({ stopped: held.size })
  })

  app.post('/api/reviews', async (c) => {
    const submitted = (await c.req.json().catch(() => undefined)) as { root?: unknown } | undefined
    if (typeof submitted?.root !== 'string') {
      return c.json({ error: 'Opening a Review needs the folder it is of' }, 400)
    }

    try {
      return c.json(await open(submitted.root), 201)
    } catch (cause) {
      return c.json({ error: cause instanceof Error ? cause.message : String(cause) }, 400)
    }
  })

  app.all(`${REVIEW_PREFIX}/:id`, (c) => serveReview(c.req.raw))
  app.all(`${REVIEW_PREFIX}/:id/*`, (c) => serveReview(c.req.raw))

  // Assets, and nothing else: the Desk root is an index, not a client, so an
  // unknown path here is a miss rather than the shell.
  app.get('/*', async (c) => (await readClientFile(c.req.path)) ?? c.notFound())

  /**
   * Everything under a Review's own path: its API, and otherwise the client.
   * The prefix is stripped before the Review's app sees it, so `createReviewApp`
   * stays a single-Review app that knows nothing about the Desk holding it.
   */
  async function serveReview(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const split = splitReviewPath(url.pathname)
    if (!split) return new Response('Not found', { status: 404 })

    const review = await reopen(split.id)
    if (!review) {
      return new Response(notOnTheDesk(split.id), {
        status: 404,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }

    if (!split.rest.startsWith('/api/')) {
      const shell = await clientShell()
      return shell ?? new Response('Client not built. Run `npm run build`.', { status: 500 })
    }

    touch(review)

    const forwarded = new URL(url)
    forwarded.pathname = split.rest
    const init: RequestInit = { method: request.method, headers: request.headers }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // Buffered rather than streamed: a Draft write is the largest body here
      // and it is a local file, so the copy costs nothing worth the complexity
      // of a half-duplex stream.
      init.body = await request.arrayBuffer()
    }
    return review.app.fetch(new Request(forwarded, init))
  }

  // ---- listening ---------------------------------------------------------

  const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    const started = serve({ fetch: app.fetch, port: bound.port }, () => resolve(started))
    started.on('error', reject)
  })

  const address = server.address()
  bound.port = typeof address === 'object' && address ? address.port : bound.port

  // Changes to a Review are pushed, not polled: the reviewer watches the agent's
  // work land in the window they already have open. Upgrades are routed by hand
  // because which Reviews exist changes while the Desk is running.
  const sockets = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => {
    const permitted = isLoopbackHost(request.headers.host, bound.port)
    const url = new URL(request.url ?? '/', `http://localhost:${bound.port}`)
    const split = splitReviewPath(url.pathname)

    if (!permitted || !split || split.rest !== EVENTS_SUFFIX) {
      socket.destroy()
      return
    }

    void reopen(split.id).then((review) => {
      if (!review) {
        socket.destroy()
        return
      }
      sockets.handleUpgrade(request, socket, head, (client) => {
        review.clients.add(client)
        clearTimeout(review.idle)
        client.on('close', () => {
          review.clients.delete(client)
          if (held.get(review.id) === review) touch(review)
        })
      })
    })
  })

  async function close(): Promise<void> {
    stopping ??= (async () => {
      clearTimeout(grace)
      for (const id of [...held.keys()]) {
        const review = held.get(id)!
        clearTimeout(review.idle)
        held.delete(id)
        review.unsubscribe()
        await review.watcher.close()
        for (const socket of review.clients) socket.close()
      }
      await new Promise<void>((resolve) => sockets.close(() => resolve()))
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })()
    return stopping
  }

  considerStopping()

  return {
    get port() {
      return bound.port
    },
    get url() {
      return `http://localhost:${bound.port}`
    },
    open,
    reviews: () => [...held.values()].map(described),
    close,
  }
}

function notOnTheDesk(id: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><title>galley</title>
<style>body{margin:0;padding:3rem 1.5rem;font:15px/1.6 ui-sans-serif,system-ui,sans-serif}
main{max-width:34rem;margin:0 auto}code{font-family:ui-monospace,SFMono-Regular,monospace}
p{color:#8886}</style></head>
<body><main><h1>Not on the Desk</h1>
<p><code>${id.replace(/[<&]/g, '')}</code> is not a Review this Desk is holding, and it is not
remembered — the folder may have moved or been deleted. Run <code>galley &lt;folder&gt;</code>
to open it again, or see <a href="/">what is on the Desk</a>.</p>
</main></body></html>
`
}
