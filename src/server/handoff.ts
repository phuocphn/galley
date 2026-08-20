import path from 'node:path'
import type { Note, NoteKind } from '../shared/types.js'
import { countByKind } from './kind.js'
import { NOTES_FILE, SIDECAR_DIRECTORY } from './sidecar.js'
import { statusOf } from './status.js'

/**
 * The instruction the reviewer pastes into their agent.
 *
 * It has to stand entirely on its own: the agent receiving it has no memory of
 * this tool, so the text says where the sidecar is, what is outstanding, what
 * each Kind present is asking for, how to locate each Note, how to reply, and
 * that the Drafts may have been hand-edited (see `docs/adr/0003`).
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
    // Up front, before the mechanics: a Question wants an answer, and an agent
    // that reads only the first paragraph should still know that.
    ...kindGuidance(outstanding),
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

/** What each Kind asks of the agent. Only the Kinds actually present are explained. */
const KIND_MEANINGS: Record<NoteKind, string> = {
  fix: '- `fix` — change the anchored text. This is what most Notes are.',
  question:
    '- `question` — the reviewer is asking you something. Answer it in a Reply and leave the Draft alone. Do not edit anything for a Question.',
  idea: '- `idea` — a suggestion, not an instruction. Use your judgement, and say in your Reply what you decided and why.',
}

/** How many outstanding Notes are of a Kind, in words. */
const KIND_TALLIES: Record<NoteKind, (n: number) => string> = {
  fix: (n) => `${n} ask${n === 1 ? 's' : ''} for a fix`,
  question: (n) => (n === 1 ? '1 is a question' : `${n} are questions`),
  idea: (n) => (n === 1 ? '1 is an idea' : `${n} are ideas`),
}

/**
 * The Kinds present and what each one asks for.
 *
 * The tally comes first so the agent knows before it starts whether anything
 * here wants an answer rather than an edit.
 */
function kindGuidance(outstanding: Note[]): string[] {
  const counts = countByKind(outstanding)
  const present = [...counts.keys()]

  return [
    `Each Note carries a \`kind\` saying what it asks of you. Of those, ${list(
      present.map((kind) => KIND_TALLIES[kind](counts.get(kind)!)),
    )}.`,
    '',
    ...present.map((kind) => KIND_MEANINGS[kind]),
    '',
  ]
}

/** `a`, `a and b`, `a, b, and c`. */
function list(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`
}

function summarise(open: number, answered: number): string {
  // Each clause carries its own verb: with one Note open and one answered, a
  // shared verb chosen from the total reads as "There are 1 Note still open".
  const clauses = [`${count(open, 'Note')} ${open === 1 ? 'is' : 'are'} still open`]
  if (answered > 0) {
    clauses.push(
      `${count(answered, 'Note')} ${answered === 1 ? 'has' : 'have'} already been answered but not yet accepted`,
    )
  }
  return `${clauses.join(', and ')}.`
}
