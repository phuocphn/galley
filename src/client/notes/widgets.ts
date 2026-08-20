import { EditorView, WidgetType } from '@codemirror/view'
import type { ResolvedNote } from '../../shared/types.js'
import { button, element } from './dom.js'
import { renderMarkdown } from './markdown.js'
import { closeComposer, setEditing, toggleCollapsed } from './state.js'

/** What a thread or composer can ask the app to do. */
export interface NoteHandlers {
  create(range: { from: number; to: number }, body: string): Promise<void>
  update(id: string, body: string): Promise<void>
  remove(id: string): Promise<void>
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

  const cancel = button('Cancel', 'cm-noteButton', options.onCancel)

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
    'cm-noteEditor',
    textarea,
    error,
    element('div', 'cm-noteActions', confirm, cancel),
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

    const body = editor({
      initialValue: '',
      placeholder: 'What should the agent do here?',
      confirmLabel: 'Leave Note',
      onConfirm: (text) => this.handlers.create({ from: this.from, to: this.to }, text),
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
    return (
      other.note.id === this.note.id &&
      other.note.body === this.note.body &&
      other.note.updatedAt === this.note.updatedAt &&
      other.collapsed === this.collapsed &&
      other.editing === this.editing
    )
  }

  override toDOM(view: EditorView): HTMLElement {
    const { note } = this
    const toggle = () => view.dispatch({ effects: toggleCollapsed.of(note.id) })

    if (this.collapsed) {
      const summary = note.body.split('\n')[0] ?? ''
      const thread = element(
        'div',
        'cm-noteThread cm-noteThread--collapsed',
        element(
          'div',
          'cm-noteHeader',
          element('span', 'cm-noteHeaderLabel', 'Note'),
          element('span', 'cm-noteSummary', summary),
          button('Expand', 'cm-noteButton cm-noteButton--quiet', toggle),
        ),
      )
      return element('div', 'cm-noteBlock', thread)
    }

    const header = element(
      'div',
      'cm-noteHeader',
      element('span', 'cm-noteHeaderLabel', 'Note'),
      button('Collapse', 'cm-noteButton cm-noteButton--quiet', toggle),
    )

    if (this.editing) {
      const thread = element(
        'div',
        'cm-noteThread',
        header,
        editor({
          initialValue: note.body,
          placeholder: 'What should the agent do here?',
          confirmLabel: 'Save',
          onConfirm: (text) => this.handlers.update(note.id, text),
          onCancel: () => view.dispatch({ effects: setEditing.of(null) }),
        }),
      )
      queueMicrotask(() => thread.querySelector('textarea')?.focus())
      return element('div', 'cm-noteBlock', thread)
    }

    const rendered = element('div', 'cm-noteBody')
    rendered.innerHTML = renderMarkdown(note.body)

    const thread = element(
      'div',
      'cm-noteThread',
      header,
      rendered,
      element(
        'div',
        'cm-noteActions',
        button('Edit', 'cm-noteButton', () => view.dispatch({ effects: setEditing.of(note.id) })),
        button('Delete', 'cm-noteButton cm-noteButton--danger', () => {
          void this.handlers.remove(note.id)
        }),
      ),
    )

    return element('div', 'cm-noteBlock', thread)
  }

  override ignoreEvent(): boolean {
    return true
  }
}
