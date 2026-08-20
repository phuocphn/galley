import { EditorView, WidgetType } from '@codemirror/view'
import {
  NOTE_KINDS,
  type NoteChange,
  type NoteKind,
  type NoteStatus,
  type Reply,
  type ResolvedNote,
} from '../../shared/types.js'
import { button, element } from './dom.js'
import { renderMarkdown } from './markdown.js'
import { closeComposer, setEditing, toggleCollapsed } from './state.js'

/** What a thread or composer can ask the app to do. */
export interface NoteHandlers {
  /** The range the Note attaches to, plus the Kind the composer settled on. */
  create(range: { from: number; to: number }, note: { body: string; kind: NoteKind }): Promise<void>
  /** New text, a new Kind, or both. A bare string is the new text. */
  update(id: string, change: NoteChange): Promise<void>
  remove(id: string): Promise<void>
  reply(id: string, body: string): Promise<void>
  resolve(id: string): Promise<void>
  /** Point an Orphaned Note at new text. */
  reattach(id: string, range: { from: number; to: number }): Promise<void>
}

const STATUS_LABELS: Record<NoteStatus, string> = {
  open: 'Open',
  answered: 'Answered',
  resolved: 'Resolved',
}

function statusChip(status: NoteStatus): HTMLElement {
  return element('span', `cm-noteStatus cm-noteStatus--${status}`, STATUS_LABELS[status])
}

const KIND_LABELS: Record<NoteKind, string> = {
  fix: 'Fix',
  question: 'Question',
  idea: 'Idea',
}

/** What choosing each Kind commits the agent to, in the reviewer's terms. */
const KIND_HINTS: Record<NoteKind, string> = {
  fix: 'Change this text.',
  question: 'Answer me in a Reply — don’t edit.',
  idea: 'Optional. Use your judgement.',
}

/** The Kind of a saved Note, at a glance. */
function kindChip(kind: NoteKind): HTMLElement {
  const chip = element('span', `cm-noteKind cm-noteKind--${kind}`, KIND_LABELS[kind])
  chip.title = KIND_HINTS[kind]
  return chip
}

/**
 * The Fix / Question / Idea choice, for a Note being written or edited.
 *
 * The chosen Kind lives in this closure rather than in editor state: it is only
 * a decision until the Note is saved, and the widget is rebuilt from the saved
 * Note either way.
 */
function kindChooser(initial: NoteKind): { node: HTMLElement; chosen: () => NoteKind } {
  let chosen: NoteKind = initial

  const hint = element('span', 'cm-noteKindHint')
  const options = element('div', 'cm-noteKindOptions')
  options.setAttribute('role', 'group')
  options.setAttribute('aria-label', 'Kind')

  const buttons = new Map<NoteKind, HTMLButtonElement>()

  const choose = (kind: NoteKind): void => {
    chosen = kind
    for (const [candidate, node] of buttons) {
      const picked = candidate === kind
      node.className = picked
        ? `cm-noteKindOption cm-noteKindOption--picked cm-noteKind--${candidate}`
        : 'cm-noteKindOption'
      node.setAttribute('aria-pressed', String(picked))
    }
    hint.textContent = KIND_HINTS[kind]
  }

  for (const kind of NOTE_KINDS) {
    const node = button(KIND_LABELS[kind], 'cm-noteKindOption', () => choose(kind))
    node.title = KIND_HINTS[kind]
    buttons.set(kind, node)
    options.append(node)
  }
  choose(initial)

  return {
    node: element('div', 'cm-noteKindChooser', options, hint),
    chosen: () => chosen,
  }
}

/** One Reply under a Note — the agent reporting back, or the reviewer pushing back. */
function replyBlock(reply: Reply): HTMLElement {
  const rendered = element('div', 'cm-noteBody')
  rendered.innerHTML = renderMarkdown(reply.body)

  return element(
    'div',
    `cm-noteReply cm-noteReply--${reply.author}`,
    element(
      'div',
      'cm-noteReplyHeader',
      element('span', 'cm-noteReplyAuthor', reply.author === 'agent' ? 'Agent' : 'You'),
      element('span', 'cm-noteReplyWhen', new Date(reply.createdAt).toLocaleString()),
    ),
    rendered,
  )
}

function lineRange(view: EditorView, from: number, to: number): string {
  const start = view.state.doc.lineAt(from).number
  const end = view.state.doc.lineAt(Math.max(from, to - 1)).number
  return start === end ? `line ${start}` : `lines ${start}–${end}`
}

/** A textarea plus a confirm/cancel pair, shared by the composer and edit mode. */
function editor(options: {
  initialValue: string
  placeholder: string
  confirmLabel: string
  onConfirm: (body: string) => Promise<void>
  onCancel: () => void
  /** A reply box, which sits inside an existing thread and has no Cancel. */
  quiet?: boolean
  /** Shown above the textarea — the Kind chooser, where there is one. */
  lead?: HTMLElement
}): HTMLElement {
  const textarea = element('textarea', 'cm-noteTextarea')
  textarea.value = options.initialValue
  textarea.placeholder = options.placeholder
  textarea.rows = 3

  const error = element('p', 'cm-noteError')
  error.hidden = true

  const confirm = button(options.confirmLabel, 'cm-noteButton cm-noteButton--primary', async () => {
    const body = textarea.value.trim()
    if (body === '') {
      error.textContent = 'A Note needs something to say.'
      error.hidden = false
      textarea.focus()
      return
    }

    confirm.disabled = true
    error.hidden = true
    try {
      await options.onConfirm(body)
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : 'Could not save that Note.'
      error.hidden = false
      confirm.disabled = false
    }
  })

  const cancel = options.quiet ? undefined : button('Cancel', 'cm-noteButton', options.onCancel)

  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      options.onCancel()
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      confirm.click()
    }
  })

  return element(
    'div',
    options.quiet ? 'cm-noteEditor cm-noteEditor--reply' : 'cm-noteEditor',
    ...(options.lead ? [options.lead] : []),
    textarea,
    error,
    element('div', 'cm-noteActions', ...(cancel ? [confirm, cancel] : [confirm])),
  )
}

/** The inline composer, opened from the gutter. */
export class ComposerWidget extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly to: number,
    private readonly handlers: NoteHandlers,
  ) {
    super()
  }

  override eq(other: ComposerWidget): boolean {
    return other.from === this.from && other.to === this.to
  }

  override toDOM(view: EditorView): HTMLElement {
    const close = () => view.dispatch({ effects: closeComposer.of(null) })
    const kind = kindChooser('fix')

    const body = editor({
      initialValue: '',
      placeholder: 'What should the agent do here?',
      confirmLabel: 'Leave Note',
      lead: kind.node,
      onConfirm: (text) =>
        this.handlers.create(
          { from: this.from, to: this.to },
          { body: text, kind: kind.chosen() },
        ),
      onCancel: close,
    })

    const thread = element(
      'div',
      'cm-noteThread cm-noteThread--composing',
      element(
        'div',
        'cm-noteHeader',
        element('span', 'cm-noteHeaderLabel', `New Note on ${lineRange(view, this.from, this.to)}`),
      ),
      body,
    )

    queueMicrotask(() => thread.querySelector('textarea')?.focus())
    return element('div', 'cm-noteBlock', thread)
  }

  override ignoreEvent(): boolean {
    return true
  }
}

/** One saved Note, rendered beneath the text it is about. */
export class ThreadWidget extends WidgetType {
  constructor(
    private readonly note: ResolvedNote,
    private readonly collapsed: boolean,
    private readonly editing: boolean,
    private readonly handlers: NoteHandlers,
  ) {
    super()
  }

  override eq(other: ThreadWidget): boolean {
    // Every field that changes what is drawn. An agent editing the sidecar by
    // hand can change the Status without touching `updatedAt`, so Status and
    // Reply count are compared in their own right.
    return (
      other.note.id === this.note.id &&
      other.note.body === this.note.body &&
      other.note.updatedAt === this.note.updatedAt &&
      other.note.kind === this.note.kind &&
      other.note.status === this.note.status &&
      other.note.replies.length === this.note.replies.length &&
      other.collapsed === this.collapsed &&
      other.editing === this.editing
    )
  }

  override toDOM(view: EditorView): HTMLElement {
    const { note } = this
    const toggle = () => view.dispatch({ effects: toggleCollapsed.of(note.id) })

    if (this.collapsed) {
      const summary = note.body.split('\n')[0] ?? ''
      const replyCount =
        note.replies.length > 0
          ? element(
              'span',
              'cm-noteReplyCount',
              `${note.replies.length} ${note.replies.length === 1 ? 'reply' : 'replies'}`,
            )
          : element('span', 'cm-noteReplyCount cm-noteReplyCount--none')

      const thread = element(
        'div',
        `cm-noteThread cm-noteThread--collapsed cm-noteThread--${note.status}`,
        element(
          'div',
          'cm-noteHeader',
          element('span', 'cm-noteHeaderLabel', 'Note'),
          kindChip(note.kind),
          statusChip(note.status),
          element('span', 'cm-noteSummary', summary),
          replyCount,
          button('Expand', 'cm-noteButton cm-noteButton--quiet', toggle),
        ),
      )
      return element('div', 'cm-noteBlock', thread)
    }

    const header = element(
      'div',
      'cm-noteHeader',
      element('span', 'cm-noteHeaderLabel', 'Note'),
      kindChip(note.kind),
      statusChip(note.status),
      button('Collapse', 'cm-noteButton cm-noteButton--quiet', toggle),
    )

    if (this.editing) {
      // Editing a Note is where its Kind can be changed: the reviewer often
      // only realises it was a Question once they have written it out.
      const kind = kindChooser(note.kind)

      const thread = element(
        'div',
        `cm-noteThread cm-noteThread--${note.status}`,
        header,
        editor({
          initialValue: note.body,
          placeholder: 'What should the agent do here?',
          confirmLabel: 'Save',
          lead: kind.node,
          onConfirm: (text) => this.handlers.update(note.id, { body: text, kind: kind.chosen() }),
          onCancel: () => view.dispatch({ effects: setEditing.of(null) }),
        }),
      )
      queueMicrotask(() => thread.querySelector('textarea')?.focus())
      return element('div', 'cm-noteBlock', thread)
    }

    const rendered = element('div', 'cm-noteBody')
    rendered.innerHTML = renderMarkdown(note.body)

    const actions = element(
      'div',
      'cm-noteActions',
      button('Edit', 'cm-noteButton', () => view.dispatch({ effects: setEditing.of(note.id) })),
      button('Delete', 'cm-noteButton cm-noteButton--danger', () => {
        void this.handlers.remove(note.id)
      }),
    )

    if (note.status !== 'resolved') {
      actions.prepend(
        button('Resolve', 'cm-noteButton cm-noteButton--primary', () => {
          void this.handlers.resolve(note.id)
        }),
      )
    }

    const thread = element(
      'div',
      `cm-noteThread cm-noteThread--${note.status}`,
      header,
      rendered,
      ...note.replies.map(replyBlock),
      actions,
      // Always open, like a pull request thread: replying is one click, and
      // replying to an Answered Note is how the reviewer pushes back.
      editor({
        initialValue: '',
        placeholder:
          note.status === 'answered' ? 'Not quite — reply to reopen…' : 'Reply…',
        confirmLabel: 'Reply',
        onConfirm: (text) => this.handlers.reply(note.id, text),
        onCancel: () => {},
        quiet: true,
      }),
    )

    return element('div', 'cm-noteBlock', thread)
  }

  override ignoreEvent(): boolean {
    return true
  }
}
