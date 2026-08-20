import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Note, Sidecar } from '../shared/types.js'
import { withKind } from './kind.js'

export const SIDECAR_DIRECTORY = '.feedback'
export const NOTES_FILE = 'notes.json'
export const README_FILE = 'README.md'

const EMPTY: Sidecar = { version: 1, notes: [] }

export function sidecarPath(reviewRoot: string, file: string): string {
  return path.join(reviewRoot, SIDECAR_DIRECTORY, file)
}

/**
 * Every Note in the Review. An absent or unreadable sidecar reads as empty.
 *
 * A Note with no `kind` — one written before Kinds existed, or added by an
 * agent editing the file by hand — comes back as a Fix, so nothing downstream
 * has to keep asking whether the field is there.
 */
export async function readNotes(reviewRoot: string): Promise<Note[]> {
  try {
    const raw = await readFile(sidecarPath(reviewRoot, NOTES_FILE), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Sidecar>
    return Array.isArray(parsed.notes) ? parsed.notes.map(withKind) : []
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

- \`notes.json\` — every **Note** a reviewer has left: on a passage of a
  **Draft**, on a whole Draft, or on this folder as a whole.

## How far a Note reaches

A Note is not always about one passage. How far it reaches is derived from what
it has — there is no \`scope\` field to read:

| \`draftPath\` | \`anchor\` | What it is about |
| --- | --- | --- |
| set | set | That exact passage of that Draft. |
| set | absent | That whole Draft, not any one passage of it. |
| absent | absent | **The whole folder.** Apply it to *every* Draft here, not to one. |

The last row is the one that is easy to get wrong. A Note with no \`draftPath\`
— "stop using em dashes", "every file needs a summary section" — is a standing
instruction for the entire Review. Working through it means visiting every
Draft in this folder and applying it to each, then leaving a single Reply on
that one Note saying what you did across all of them.

## How to act on it

Read \`notes.json\` and work on every Note whose \`status\` is not \`resolved\`:

| Field | Meaning |
| --- | --- |
| \`id\` | Stable identifier. Never change it. |
| \`draftPath\` | The Draft this Note is about, relative to this folder's parent. Absent when the Note is about the whole folder. |
| \`anchor\` | Absent when the Note is about a whole Draft or the whole folder. There is then nothing to locate — the Note is about all of it. |
| \`anchor.text\` | The exact text the Note is about. **This is what locates the Note** — search for it in the Draft. |
| \`anchor.before\` / \`anchor.after\` | The text either side of the anchor, for telling repeated passages apart. |
| \`anchor.startLine\` / \`anchor.endLine\` | Where the anchor was when the Note was written. A hint for you as a human reader — it goes stale as soon as the Draft changes, so do not rely on it. |
| \`body\` | The reviewer's guidance, in Markdown. |
| \`kind\` | What the Note asks you to do: \`fix\`, \`question\`, or \`idea\`. See below. |
| \`status\` | \`open\`, \`answered\`, or \`resolved\`. See below. |
| \`replies\` | The back-and-forth under the Note, oldest first. |
| \`createdAt\` / \`updatedAt\` | ISO timestamps. |

## Kinds

A Note's \`kind\` says what it is asking of you. It is not a severity — each
value asks for something different:

| Kind | What it asks you to do |
| --- | --- |
| \`fix\` | Change the anchored text. This is what most Notes are. |
| \`question\` | The reviewer is asking you something. Answer it in a Reply and leave the Draft alone — a Question is not an instruction to edit. |
| \`idea\` | A suggestion, not an instruction. Use your judgement, and say in your Reply what you decided and why. |

A Note with no \`kind\` was written before Kinds existed. Read it as \`fix\`.

## Replying

For every Note you act on, append an entry to its \`replies\` array saying what
you changed — or why you didn't:

\`\`\`json
{
  "id": "<new uuid>",
  "author": "agent",
  "body": "Named all three items and dropped the bold.",
  "createdAt": "2026-01-01T00:00:00.000Z"
}
\`\`\`

Then set that Note's \`status\` to \`"answered"\`.

**Do not set \`"resolved"\`.** Accepting the work is the reviewer's call — they
read the revision and resolve the Note themselves. If they aren't satisfied they
reply again, which puts the Note back to \`open\`.

A Note whose \`kind\` is \`question\` wants an answer in a Reply, not an edit.
Reply to it and set it to \`"answered"\` without touching the Draft.

## Rules for writing this file

Never rewrite \`notes.json\` wholesale. Read it, change the entries you mean to
change, and write it back — the reviewer may be adding Notes at the same moment,
and merging by \`id\` is what keeps both sides' work.

The reviewer may also have edited the Drafts by hand. Treat the current content
as intentional and change only what the Notes ask for.
`

async function writeSidecarReadme(reviewRoot: string): Promise<void> {
  await writeFile(sidecarPath(reviewRoot, README_FILE), SIDECAR_README, 'utf8')
}
