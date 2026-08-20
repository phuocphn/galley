import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { keepingLocalAnchors, notesField, setNotes } from '../src/client/notes/state.js'
import type { ResolvedNote } from '../src/shared/types.js'

/**
 * Anchors while the reviewer is typing.
 *
 * `docs/adr/0002` splits the job in two: on reload an Anchor is re-found by
 * matching its stored text — that is `reanchoring.test.ts` — and within a
 * session it is mapped through the reviewer's keystrokes. This is that second
 * half, driven through the actual CodeMirror state field the Draft pane runs, so
 * a Note attached to a sentence stays attached to that sentence no matter what
 * gets typed around it. Getting this wrong is invisible: a thread rendered
 * against the wrong sentence looks exactly like one rendered against the right
 * sentence.
 *
 * `@codemirror/state` is a plain data library with no DOM in it, so this needs
 * no browser — the pane itself is still verified by running it.
 */

const WHEN = '2026-01-01T00:00:00.000Z'

function noteOn(content: string, phrase: string, id = 'note-1'): ResolvedNote {
  const from = content.indexOf(phrase)
  expect(from, `"${phrase}" is not in the Draft`).toBeGreaterThanOrEqual(0)

  return {
    id,
    draftPath: 'findings.md',
    anchor: { text: phrase, before: '', after: '', startLine: 1, endLine: 1 },
    body: 'This claim is unsourced.',
    status: 'open',
    replies: [],
    createdAt: WHEN,
    updatedAt: WHEN,
    range: { from, to: from + phrase.length },
    match: 'exact',
  }
}

/** A Draft pane showing one Note, ready to be typed in. */
function paneShowing(content: string, ...showing: ResolvedNote[]): EditorState {
  const state = EditorState.create({ doc: content, extensions: [notesField] })
  return state.update({ effects: setNotes.of(showing) }).state
}

function anchored(state: EditorState, id = 'note-1'): string {
  const note = state.field(notesField).find((candidate) => candidate.id === id)
  expect(note, `no Note ${id} in the pane`).toBeDefined()
  expect(note!.range).not.toBeNull()
  return state.doc.sliceString(note!.range!.from, note!.range!.to)
}

const DRAFT = `# Findings

Our model outperforms every published baseline on the benchmark.

We trained it on a curated corpus of 40,000 documents.
`

const PHRASE = 'outperforms every published baseline'

describe('an Anchor while the reviewer edits the Draft', () => {
  it('follows the text when a paragraph is typed above it', () => {
    const pane = paneShowing(DRAFT, noteOn(DRAFT, PHRASE))

    const typed = pane.update({
      changes: { from: 0, insert: '# Summary\n\nWritten by the reviewer.\n\n' },
    }).state

    expect(anchored(typed)).toBe(PHRASE)
  })

  it('follows the text when a line above it is deleted', () => {
    const pane = paneShowing(DRAFT, noteOn(DRAFT, PHRASE))

    const heading = '# Findings\n\n'
    const typed = pane.update({ changes: { from: 0, to: heading.length } }).state

    expect(anchored(typed)).toBe(PHRASE)
    expect(typed.doc.toString().startsWith('Our model')).toBe(true)
  })

  it('follows the text when the reviewer types below it', () => {
    const pane = paneShowing(DRAFT, noteOn(DRAFT, PHRASE))

    const typed = pane.update({
      changes: { from: DRAFT.length, insert: '\nAnd a closing thought.\n' },
    }).state

    expect(anchored(typed)).toBe(PHRASE)
  })

  it('grows to cover a word typed inside it', () => {
    const pane = paneShowing(DRAFT, noteOn(DRAFT, PHRASE))

    const at = DRAFT.indexOf('every published')
    const typed = pane.update({ changes: { from: at, insert: 'nearly ' } }).state

    expect(anchored(typed)).toBe('outperforms nearly every published baseline')
  })

  it('shrinks to what is left when text inside it is deleted', () => {
    const pane = paneShowing(DRAFT, noteOn(DRAFT, PHRASE))

    const at = DRAFT.indexOf('published ')
    const typed = pane.update({ changes: { from: at, to: at + 'published '.length } }).state

    expect(anchored(typed)).toBe('outperforms every baseline')
  })

  it('does not swallow text typed against its front edge', () => {
    const pane = paneShowing(DRAFT, noteOn(DRAFT, PHRASE))

    const typed = pane.update({ changes: { from: DRAFT.indexOf(PHRASE), insert: 'clearly ' } }).state

    expect(anchored(typed)).toBe(PHRASE)
  })

  it('does not swallow text typed against its back edge', () => {
    const pane = paneShowing(DRAFT, noteOn(DRAFT, PHRASE))

    const end = DRAFT.indexOf(PHRASE) + PHRASE.length
    const typed = pane.update({ changes: { from: end, insert: ' anywhere' } }).state

    expect(anchored(typed)).toBe(PHRASE)
  })

  it('keeps every Anchor in its own place when several Notes are open', () => {
    const first = noteOn(DRAFT, PHRASE, 'note-1')
    const second = noteOn(DRAFT, 'a curated corpus of 40,000 documents', 'note-2')
    const pane = paneShowing(DRAFT, first, second)

    const typed = pane.update({
      changes: [
        { from: 0, insert: 'Preface.\n\n' },
        { from: DRAFT.indexOf('on the benchmark'), insert: 'convincingly ' },
      ],
    }).state

    expect(anchored(typed, 'note-1')).toBe(PHRASE)
    expect(anchored(typed, 'note-2')).toBe('a curated corpus of 40,000 documents')
  })

  it('collapses rather than inverting when the reviewer deletes the whole passage', () => {
    const pane = paneShowing(DRAFT, noteOn(DRAFT, PHRASE))

    const line = DRAFT.indexOf('Our model')
    const typed = pane.update({
      changes: { from: line, to: DRAFT.indexOf('\n\nWe trained') },
    }).state

    // The Note is still outstanding and still in the pane — whether the passage
    // is gone for good is the next reload's question, not a keystroke's.
    const note = typed.field(notesField)[0]!
    expect(note.range!.from).toBe(note.range!.to)
    expect(note.range!.from).toBeLessThanOrEqual(typed.doc.length)
  })

  it('takes a fresh set from the server as given rather than mapping it', () => {
    const pane = paneShowing(DRAFT, noteOn(DRAFT, PHRASE))

    const rewritten = `Preface.\n\n${DRAFT}`
    const reloaded = pane.update({
      changes: { from: 0, to: pane.doc.length, insert: rewritten },
      effects: setNotes.of([noteOn(rewritten, PHRASE)]),
    }).state

    expect(anchored(reloaded)).toBe(PHRASE)
  })
})

describe('Notes arriving while the buffer has unsaved edits', () => {
  it('keeps the Anchor the pane mapped and takes the rest from the server', () => {
    const showing = paneShowing(DRAFT, noteOn(DRAFT, PHRASE))
      .update({ changes: { from: 0, insert: 'Preface.\n\n' } })
      .state

    // The server located this against the file on disk, which is one paragraph
    // behind what the reviewer is looking at.
    const fromServer: ResolvedNote = {
      ...noteOn(DRAFT, PHRASE),
      status: 'answered',
      replies: [{ id: 'r1', author: 'agent', body: 'Cited it.', createdAt: WHEN }],
    }

    const merged = showing.update({
      effects: setNotes.of(keepingLocalAnchors([fromServer], showing.field(notesField))),
    }).state

    expect(anchored(merged)).toBe(PHRASE)
    expect(merged.field(notesField)[0]!.status).toBe('answered')
    expect(merged.field(notesField)[0]!.replies).toHaveLength(1)
  })

  it('takes the server Anchor for a Note the pane has never shown', () => {
    const showing = paneShowing(DRAFT)
    const fromServer = noteOn(DRAFT, PHRASE)

    const merged = keepingLocalAnchors([fromServer], showing.field(notesField))

    expect(merged[0]!.range).toEqual(fromServer.range)
  })
})
