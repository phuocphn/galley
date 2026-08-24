#!/usr/bin/env node
import process from 'node:process'
import { DEFAULT_PORT, startDesk } from './desk.js'

/**
 * Run the Desk in this process.
 *
 * This is what the CLI spawns detached, and what `npm run dev:server` runs in
 * the foreground. It is not a `galley` subcommand: a Desk tied to one terminal
 * is exactly the trap the Desk exists to avoid, since Ctrl-C there would take
 * down Reviews opened from other terminals.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2)

  const portFlag = argv.indexOf('--port')
  const port = Number(
    portFlag === -1 ? (process.env.PORT ?? DEFAULT_PORT) : (argv[portFlag + 1] ?? DEFAULT_PORT),
  )
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`galley: ${argv[portFlag + 1]} is not a port`)
    process.exit(1)
  }

  const desk = await startDesk({ port, onStopped: () => process.exit(0) })
  console.log(`[${new Date().toISOString()}] Desk listening on ${desk.url}`)

  // A folder given here is opened straight away, which is how `dev:server` puts
  // something on the Desk to work against.
  const folders = argv.filter((argument, index) => !argument.startsWith('--') && index !== portFlag + 1)
  for (const folder of folders) {
    const review = await desk.open(folder)
    console.log(`[${new Date().toISOString()}] Reviewing ${review.root} at ${review.url}`)
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void desk.close().then(() => process.exit(0))
    })
  }
}

main().catch((error: unknown) => {
  console.error(`galley: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  process.exit(1)
})
