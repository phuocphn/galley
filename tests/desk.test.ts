import { request as httpRequest } from 'node:http'
import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Note, ReviewListing } from '../src/shared/types.js'
import { canonicalRoot, reviewId } from '../src/desk/address.js'
import { startDesk, type Desk } from '../src/desk/desk.js'
import { GALLEY_VERSION } from '../src/desk/version.js'

// The Desk holds a chokidar watcher per Review, and letting go of it is the
// point of closing one — so the test needs the watcher the Desk made.
const watching = vi.hoisted(() => ({ watchers: [] as { closed: boolean }[] }))
vi.mock('../src/server/watcher.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/watcher.js')>()
  return {
    watchReview: (root: string, events: Parameters<typeof actual.watchReview>[1]) => {
      const watcher = actual.watchReview(root, events)
      watching.watchers.push(watcher)
      return watcher
    },
  }
})


const DRAFT = `# Findings

The model reports a 40% improvement.
`

let desks: Desk[] = []

afterEach(async () => {
  await Promise.all(desks.map((desk) => desk.close()))
  desks = []
  watching.watchers = []
})

async function openDesk(options: Parameters<typeof startDesk>[0] = {}): Promise<Desk> {
  const desk = await startDesk({ port: 0, ...options })
  desks.push(desk)
  return desk
}

async function folder(files: Record<string, string> = { 'findings.md': DRAFT }): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'galley-desk-'))
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(root, name), contents, 'utf8')
  }
  return root
}

async function postNote(url: string, body: string): Promise<Note> {
  const response = await fetch(`${url}/api/notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  })
  if (!response.ok) throw new Error(`${url} responded ${response.status}`)
  return (await response.json()) as Note
}

async function listing(url: string): Promise<ReviewListing> {
  return (await (await fetch(`${url}/api/review`)).json()) as ReviewListing
}

/** Node's fetch refuses to send a forged Host, so this goes out by hand. */
function rawGet(port: number, pathname: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const client = httpRequest(
      { host: '127.0.0.1', port, path: pathname, method: 'GET', headers },
      (response) => {
        response.resume()
        resolve(response.statusCode ?? 0)
      },
    )
    client.on('error', reject)
    client.end()
  })
}

async function settle(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('the Desk never got there')
}

describe('a Desk holding several Reviews', () => {
  it('keeps each Review to itself', async () => {
    const desk = await openDesk()
    const first = await desk.open(await folder())
    const second = await desk.open(await folder())

    await postNote(first.url, 'This whole draft oversells the result.')

    expect((await listing(first.url)).reviewNotes).toHaveLength(1)
    expect((await listing(second.url)).reviewNotes).toHaveLength(0)
    expect(second.url).not.toEqual(first.url)
  })

  it('reads each Review at its own path', async () => {
    const desk = await openDesk()
    const review = await desk.open(await folder({ 'paper.md': DRAFT }))

    expect(new URL(review.url).pathname).toMatch(/^\/r\/galley-desk-[a-z0-9-]+-[0-9a-f]{4}$/)
    expect((await listing(review.url)).drafts.map((draft) => draft.path)).toEqual(['paper.md'])
  })
})

describe("a Review's URL", () => {
  it('is the same on a later Desk', async () => {
    const root = await folder()

    const first = await openDesk()
    const before = await first.open(root)
    await first.close()

    const second = await openDesk()
    const after = await second.open(root)

    // The port is whatever was free; the Review's own path is derived from the
    // folder, so it survives the Desk that first minted it (`docs/adr/0009`).
    expect(after.id).toEqual(before.id)
    expect(new URL(after.url).pathname).toEqual(new URL(before.url).pathname)
  })

  it('is one Review whether or not the path went through a symlink', async () => {
    const root = await folder()
    const link = path.join(await mkdtemp(path.join(tmpdir(), 'galley-link-')), 'review')
    await symlink(root, link, 'dir')

    const desk = await openDesk()
    const direct = await desk.open(root)
    const through = await desk.open(link)

    expect(through.id).toEqual(direct.id)
    expect(desk.reviews()).toHaveLength(1)
  })

  it('tells two folders of the same name apart', async () => {
    const first = path.join(await mkdtemp(path.join(tmpdir(), 'galley-a-')), 'out')
    const second = path.join(await mkdtemp(path.join(tmpdir(), 'galley-b-')), 'out')
    for (const root of [first, second]) {
      await (await import('node:fs/promises')).mkdir(root)
    }

    expect(reviewId(await canonicalRoot(first))).not.toEqual(
      reviewId(await canonicalRoot(second)),
    )
  })
})

describe('a Review nobody is looking at', () => {
  it('is closed, and lets go of its watcher', async () => {
    const desk = await openDesk({ reviewIdleMs: 20, deskGraceMs: 60_000 })
    await desk.open(await folder())

    await settle(() => desk.reviews().length === 0)
    expect(watching.watchers).toHaveLength(1)
    expect(watching.watchers[0]!.closed).toBe(true)
  })

  it('comes back with its Notes when it is asked for again', async () => {
    const desk = await openDesk({ reviewIdleMs: 40, deskGraceMs: 60_000 })
    const review = await desk.open(await folder())
    await postNote(review.url, 'Cut the 40% claim.')

    await settle(() => desk.reviews().length === 0)

    // The id is a hash, so this only works because the Desk wrote down what the
    // folder was (`docs/adr/0009`).
    const reopened = await listing(review.url)
    expect(reopened.reviewNotes.map((note) => note.body)).toEqual(['Cut the 40% claim.'])
    expect(desk.reviews().map((held) => held.id)).toEqual([review.id])
  })

  it('is a miss when the Desk has never heard of it', async () => {
    const desk = await openDesk()
    const response = await fetch(`${desk.url}/r/never-0000/api/review`)

    expect(response.status).toBe(404)
  })
})

describe('what the Desk refuses', () => {
  it('a request that asked for another name', async () => {
    const desk = await openDesk()

    expect(await rawGet(desk.port, '/api/desk', { Host: 'evil.example.com' })).toBe(403)
    expect(await rawGet(desk.port, '/api/desk', { Host: `localhost:${desk.port}` })).toBe(200)
  })

  it('a folder offered by another site', async () => {
    const desk = await openDesk()
    const response = await fetch(`${desk.url}/api/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ root: await folder() }),
    })

    expect(response.status).toBe(403)
    expect(desk.reviews()).toHaveLength(0)
  })

  it('a folder offered as anything but JSON', async () => {
    const desk = await openDesk()
    const response = await fetch(`${desk.url}/api/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ root: await folder() }),
    })

    expect(response.status).toBe(415)
    expect(desk.reviews()).toHaveLength(0)
  })

  it('a folder that is not one', async () => {
    const desk = await openDesk()
    const response = await fetch(`${desk.url}/api/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: path.join(tmpdir(), 'galley-nothing-here') }),
    })

    expect(response.status).toBe(400)
  })

  it('the port, to a second Desk', async () => {
    const desk = await openDesk()

    // The CLI can race itself: two invocations both find nothing listening and
    // both start a Desk. The loser has to fail here rather than half-serve.
    await expect(startDesk({ port: desk.port })).rejects.toThrow()
    expect((await (await fetch(`${desk.url}/api/desk`)).json()).galley).toBe(true)
  })
})

describe('what the Desk says about itself', () => {
  it('names its build, so an older one can be replaced', async () => {
    const desk = await openDesk()
    const review = await desk.open(await folder())

    const health = (await (await fetch(`${desk.url}/api/desk`)).json()) as {
      galley: boolean
      version: string
      reviews: { id: string }[]
    }

    expect(health).toMatchObject({ galley: true, version: GALLEY_VERSION })
    expect(health.reviews.map((held) => held.id)).toEqual([review.id])
  })

  it('lists what it is holding', async () => {
    const desk = await openDesk()
    const review = await desk.open(await folder())

    const index = await (await fetch(desk.url)).text()
    expect(index).toContain(review.id)
    expect(index).toContain(review.root)
  })
})
