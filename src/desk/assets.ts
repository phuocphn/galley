import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The built client, read from beside this file rather than from the working
 * directory, so the Desk works from wherever it was started.
 */
const CLIENT_DIRECTORY = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../client')

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

export async function readClientFile(pathname: string): Promise<Response | undefined> {
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
 * The client shell. Served for a Review's own path and anything under it; the
 * assets it names are absolute (`/assets/…`), so they resolve to the Desk root
 * from however deep a Review's URL goes.
 */
export function clientShell(): Promise<Response | undefined> {
  return readClientFile('/index.html')
}
