#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {
  health,
  NoDesk,
  NotGalley,
  openReview,
  sameBuild,
  spawnDesk,
  stopDesk,
} from './desk/client.js'
import { DEFAULT_PORT } from './desk/desk.js'
import { deskLogFile } from './desk/home.js'

/** How much of the Desk's log to quote when it fails to start. */
const LOG_TAIL_LINES = 8

function fail(message: string): never {
  console.error(`galley: ${message}`)
  process.exit(1)
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  const child = spawn(command, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' })
  child.on('error', () => {
    // Opening the browser is a convenience; the URL is already on stdout.
  })
  child.unref()
}

/** The last few lines of the Desk's log, for when it never came up. */
async function logTail(): Promise<string> {
  try {
    const lines = (await readFile(deskLogFile(), 'utf8')).trimEnd().split('\n')
    return lines.slice(-LOG_TAIL_LINES).join('\n')
  } catch {
    return ''
  }
}

interface Invocation {
  command: 'open' | 'stop'
  folder?: string
  port: number
  openBrowser: boolean
}

function parse(argv: string[]): Invocation {
  let port = Number(process.env.PORT ?? DEFAULT_PORT)
  let browser = true
  let command: 'open' | 'stop' = 'open'
  const rest: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!
    if (argument === '--no-open') browser = false
    else if (argument === '--port') {
      port = Number(argv[index + 1])
      index += 1
    } else if (argument.startsWith('--port=')) port = Number(argument.slice('--port='.length))
    else if (argument.startsWith('-')) fail(`I don't know the flag ${argument}`)
    else if (argument === 'stop' && rest.length === 0) command = 'stop'
    else rest.push(argument)
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`that is not a port`)
  return { command, folder: rest[0], port, openBrowser: browser }
}

/**
 * Find the Desk to use, starting one if there isn't one.
 *
 * A Desk outlives the terminal that started it, so it can end up older than the
 * CLI now talking to it — after a `npm run build`, it would answer with code you
 * have already replaced. A mismatch is replaced rather than tolerated.
 */
async function desk(port: number): Promise<{ started: boolean; replaced: boolean }> {
  try {
    const running = await health(port)
    if (sameBuild(running)) return { started: false, replaced: false }

    await stopDesk(port)
    await spawnDesk(port)
    return { started: true, replaced: true }
  } catch (cause) {
    if (cause instanceof NotGalley) {
      fail(`something else is using port ${port} — try \`galley --port <n> <folder>\``)
    }
    if (!(cause instanceof NoDesk)) throw cause
  }

  await spawnDesk(port)
  return { started: true, replaced: false }
}

async function main(): Promise<void> {
  const invocation = parse(process.argv.slice(2))

  if (invocation.command === 'stop') {
    try {
      const closed = await stopDesk(invocation.port)
      console.log(`Stopped the Desk — ${closed} ${closed === 1 ? 'Review' : 'Reviews'} closed.`)
    } catch (cause) {
      if (cause instanceof NoDesk) console.log('No Desk is running.')
      else if (cause instanceof NotGalley) fail(`something else is using port ${invocation.port}`)
      else throw cause
    }
    return
  }

  if (!invocation.folder) {
    fail('give me a folder to review, e.g. `galley ./out`')
  }

  const state = await desk(invocation.port).catch(async (cause: unknown) => {
    const tail = await logTail()
    fail(
      `${cause instanceof Error ? cause.message : String(cause)}${tail ? `\n\n${tail}` : ''}`,
    )
  })

  const review = await openReview(invocation.port, path.resolve(invocation.folder))

  if (state.replaced) console.log('Replaced a Desk running an older build.')
  else if (state.started) console.log('Started the Desk.')

  console.log(`Reviewing ${review.root}`)
  console.log(`  ${review.url}`)
  if (invocation.openBrowser) openBrowser(review.url)
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
