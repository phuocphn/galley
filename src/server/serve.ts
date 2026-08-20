import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { createReviewApp } from './app.js'

const CLIENT_DIRECTORY = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../client')

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

/**
 * Boot the Review API with the built client in front of it, and return the URL
 * to open. The client is read from beside this file, not from the working
 * directory, so the CLI works from wherever it's run.
 */
export async function startServer(reviewRoot: string, port: number): Promise<string> {
  const app = createReviewApp(reviewRoot)

  app.get('/*', async (c) => {
    const asset = await readClientFile(c.req.path)
    if (asset) return asset

    // Anything else falls through to the SPA shell.
    const shell = await readClientFile('/index.html')
    if (!shell) return c.text('Client not built. Run `npm run build`.', 500)
    return shell
  })

  await new Promise<void>((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port }, () => resolve())
    server.on('error', reject)
  })

  return `http://localhost:${port}`
}
