#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { startServer } from './server/serve.js'

const DEFAULT_PORT = 4317

function fail(message: string): never {
  console.error(`ai-feedback-editor: ${message}`)
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

async function main(): Promise<void> {
  const [folderArgument] = process.argv.slice(2)
  if (!folderArgument) {
    fail('give me a folder to review, e.g. `ai-feedback-editor ./out`')
  }

  const reviewRoot = path.resolve(folderArgument)
  let stats
  try {
    stats = await stat(reviewRoot)
  } catch {
    fail(`no such folder: ${reviewRoot}`)
  }
  if (!stats.isDirectory()) {
    fail(`not a folder: ${reviewRoot}`)
  }

  const port = Number(process.env.PORT ?? DEFAULT_PORT)
  const url = await startServer(reviewRoot, port)

  console.log(`Reviewing ${reviewRoot}`)
  console.log(`  ${url}`)
  openBrowser(url)
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
