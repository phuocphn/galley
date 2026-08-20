import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Note, Sidecar } from '../shared/types.js'

export const SIDECAR_DIRECTORY = '.feedback'
export const NOTES_FILE = 'notes.json'
export const README_FILE = 'README.md'

const EMPTY: Sidecar = { version: 1, notes: [] }

export function sidecarPath(reviewRoot: string, file: string): string {
  return path.join(reviewRoot, SIDECAR_DIRECTORY, file)
}

/** Every Note in the Review. An absent or unreadable sidecar reads as empty. */
export async function readNotes(reviewRoot: string): Promise<Note[]> {
  try {
    const raw = await readFile(sidecarPath(reviewRoot, NOTES_FILE), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Sidecar>
    return Array.isArray(parsed.notes) ? parsed.notes : []
  } catch {
    return EMPTY.notes
  }
}

/**
 * Apply a change to the Review's Notes.
 *
 * The sidecar is read from disk immediately before writing and the change is
 * applied to what's actually there, so a Note the agent added in the meantime
 * survives — see `docs/adr/0001`. The file is never written from a copy the
 * client has been holding.
 */
export async function mutateNotes(
  reviewRoot: string,
  change: (notes: Note[]) => Note[],
): Promise<Note[]> {
  const notes = change(await readNotes(reviewRoot))

  await mkdir(path.join(reviewRoot, SIDECAR_DIRECTORY), { recursive: true })
  await writeSidecarReadme(reviewRoot)

  const sidecar: Sidecar = { version: 1, notes }
  await writeFile(sidecarPath(reviewRoot, NOTES_FILE), `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8')

  return notes
}

const SIDECAR_README = `# Feedback for this folder

This folder holds review feedback on the generated content beside it. It is
written by [ai-feedback-editor](https://github.com/phuocphn/ai-feedback-editor)
and is meant to be read and acted on by a coding agent.

## What's here

- \`notes.json\` — every **Note** a reviewer has left, for every **Draft** in
  this folder.

## How to act on it

Read \`notes.json\` and address every Note whose \`status\` is \`open\`. Each Note
tells you which Draft it is about and exactly which text it is about:

| Field | Meaning |
| --- | --- |
| \`id\` | Stable identifier. Never change it. |
| \`draftPath\` | The Draft this Note is about, relative to this folder's parent. |
| \`anchor.text\` | The exact text the Note is about. **This is what locates the Note** — search for it in the Draft. |
| \`anchor.before\` / \`anchor.after\` | The text either side of the anchor, for telling repeated passages apart. |
| \`anchor.startLine\` / \`anchor.endLine\` | Where the anchor was when the Note was written. A hint for you as a human reader — it goes stale as soon as the Draft changes, so do not rely on it. |
| \`body\` | The reviewer's guidance, in Markdown. |
| \`status\` | \`open\` — still outstanding. |
| \`createdAt\` / \`updatedAt\` | ISO timestamps. |

The reviewer may also have edited the Drafts by hand. Treat the current content
as intentional and change only what the Notes ask for.

## Rules for writing this file

Never rewrite \`notes.json\` wholesale. Read it, change the entries you mean to
change, and write it back — the reviewer may be adding Notes at the same moment,
and merging by \`id\` is what keeps both sides' work.
`

async function writeSidecarReadme(reviewRoot: string): Promise<void> {
  await writeFile(sidecarPath(reviewRoot, README_FILE), SIDECAR_README, 'utf8')
}
