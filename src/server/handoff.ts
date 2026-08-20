import path from 'node:path'
import type { Note } from '../shared/types.js'
import { NOTES_FILE, SIDECAR_DIRECTORY } from './sidecar.js'
import { statusOf } from './status.js'

/**
 * The instruction the reviewer pastes into their agent.
 *
 * It has to stand entirely on its own: the agent receiving it has no memory of
 * this tool, so the text says where the sidecar is, what is outstanding, how to
 * locate each Note, how to reply, and that the Drafts may have been hand-edited
 * (see `docs/adr/0003`).
 */
export function handoffInstruction(reviewRoot: string, notes: Note[]): string {
  const outstanding = notes.filter((note) => statusOf(note) !== 'resolved')
  const open = outstanding.filter((note) => statusOf(note) === 'open')
  const answered = outstanding.filter((note) => statusOf(note) === 'answered')

  const sidecar = `${path.basename(reviewRoot)}/${SIDECAR_DIRECTORY}/${NOTES_FILE}`
  const drafts = [...new Set(outstanding.map((note) => note.draftPath))]

  if (notes.length === 0) {
    return `No Notes have been left on this Review yet, so there is nothing to hand off.`
  }

  if (outstanding.length === 0) {
    return [
      `There is no outstanding review feedback in \`${sidecar}\`.`,
      '',
      `Every one of its ${count(notes.length, 'Note')} is resolved. Nothing to do.`,
    ].join('\n')
  }

  const lines: string[] = [
    `Address the review feedback in \`${sidecar}\`.`,
    '',
    summarise(open.length, answered.length),
    '',
    'How to work through it:',
    '',
    `1. Read \`${sidecar}\`. Work on every Note whose \`status\` is not \`resolved\`.`,
    '2. Locate each Note by its `anchor.text` — search the Draft for that exact text.',
    '   `anchor.before` and `anchor.after` tell repeated passages apart. The line',
    '   numbers are only a hint and go stale as soon as the Draft changes, so do not',
    '   rely on them.',
    '3. For every Note you act on, append to its `replies` array:',
    '',
    '   ```json',
    '   { "id": "<new uuid>", "author": "agent", "body": "What you changed, or why you didn\'t.",',
    '     "createdAt": "<ISO 8601 timestamp>" }',
    '   ```',
    '',
    '   and set that Note\'s `status` to `"answered"`. Do not set `"resolved"` —',
    '   accepting the work is the reviewer\'s call.',
    '4. Never rewrite `notes.json` wholesale. Read it, change the entries you mean to',
    '   change, and write it back — the reviewer may be adding Notes at the same',
    '   moment, and merging by `id` is what keeps both sides\' work.',
    '',
    `The Drafts with outstanding feedback: ${drafts.map((draft) => `\`${draft}\``).join(', ')}.`,
    '',
    'The reviewer may also have edited these Drafts by hand. Treat the current',
    'content as intentional and change only what the Notes ask for.',
  ]

  return lines.join('\n')
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function summarise(open: number, answered: number): string {
  const parts = [`${count(open, 'Note')} still open`]
  if (answered > 0) {
    parts.push(`${count(answered, 'Note')} already answered but not yet accepted`)
  }
  return `There ${open + answered === 1 ? 'is' : 'are'} ${parts.join(', and ')}.`
}
