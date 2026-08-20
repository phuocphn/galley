import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createReviewApp } from '../../src/server/app.js'

/**
 * A throwaway Review on disk with the API booted against it.
 *
 * This is the seam every slice's tests drive: real files in a real folder,
 * exercised over HTTP, with nothing reaching inside the server's modules.
 */
export interface ReviewFixture {
  /** Absolute path of the Review root. */
  root: string
  /** Make a request against the Review API. */
  request(pathname: string): Promise<Response>
  /** Fetch and parse a JSON response, failing loudly on a non-2xx. */
  getJson<T>(pathname: string): Promise<T>
  /** Write a file into the Review, creating parent folders as needed. */
  write(relativePath: string, contents: string): Promise<void>
  /**
   * Write a file just outside the Review root, so path-escape guards can be
   * tested against something that genuinely exists.
   */
  writeOutside(relativePath: string, contents: string): Promise<void>
  /** Remove the Review from disk. */
  cleanup(): Promise<void>
}

export async function createReviewFixture(
  files: Record<string, string> = {},
): Promise<ReviewFixture> {
  // The Review sits inside a container folder so tests can also place files
  // outside it. Both are torn down together.
  const container = await mkdtemp(path.join(tmpdir(), 'ai-feedback-editor-'))
  const root = path.join(container, 'review')
  await mkdir(root, { recursive: true })
  const app = createReviewApp(root)

  const writeUnder = (base: string) => async (
    relativePath: string,
    contents: string,
  ): Promise<void> => {
    const absolute = path.join(base, relativePath)
    await mkdir(path.dirname(absolute), { recursive: true })
    await writeFile(absolute, contents, 'utf8')
  }

  const write = writeUnder(root)

  for (const [relativePath, contents] of Object.entries(files)) {
    await write(relativePath, contents)
  }

  const request = async (pathname: string): Promise<Response> =>
    await app.request(new Request(`http://localhost${pathname}`))

  return {
    root,
    request,
    write,
    writeOutside: writeUnder(container),
    async getJson<T>(pathname: string): Promise<T> {
      const response = await request(pathname)
      if (!response.ok) {
        throw new Error(`${pathname} responded ${response.status}: ${await response.text()}`)
      }
      return (await response.json()) as T
    },
    cleanup: () => rm(container, { recursive: true, force: true }),
  }
}
