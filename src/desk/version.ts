import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The build this Desk is running.
 *
 * A Desk outlives the terminal that started it, so it also outlives a
 * `npm run build`. The CLI compares this against its own and replaces a Desk
 * running older code, rather than letting it answer with a fix you already made.
 */
export const GALLEY_VERSION: string = (() => {
  try {
    const manifest = fileURLToPath(new URL('../../package.json', import.meta.url))
    return (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
})()
