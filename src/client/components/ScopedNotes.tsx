import { useState } from 'react'
import type { NoteScope } from '../../shared/scope.js'
import { NOTE_KINDS, type Note, type NoteKind } from '../../shared/types.js'

interface ScopedNotesProps {
  /** Which Scope this list is for. Only `draft` and `review` come through here. */
  scope: Exclude<NoteScope, 'range'>
  /** What these Notes are about — a Draft path, or the Review's folder name. */
  subject: string
  /** Every Note at this Scope, Resolved ones included. */
  notes: Note[]
  onCreate: (body: string, kind: NoteKind) => void
  onReply: (id: string, body: string) => void
  onResolve: (id: string) => void
  onDelete: (id: string) => void
}

/**
 * Notes that aren't about a passage — one whole Draft's worth, or one whole
 * Review's.
 *
 * A range Note draws itself next to the text it is about, which is what makes
 * it obviously about that text. These have no text to sit beside, so they are
 * given a place of their own instead of being pinned to an arbitrary line: at
 * the top of the Draft, or under the Draft list in the sidebar. Everything else
 * about them — Reply, Answered, Resolve — is the same as any other Note, so it
 * looks the same here as it does in the pane.
 */
export function ScopedNotes({
  scope,
  subject,
  notes,
  onCreate,
  onReply,
  onResolve,
  onDelete,
}: ScopedNotesProps) {
  const [composing, setComposing] = useState(false)
  const [showResolved, setShowResolved] = useState(false)

  const resolved = notes.filter((note) => note.status === 'resolved')
  const shown = showResolved ? notes : notes.filter((note) => note.status !== 'resolved')

  const onReview = scope === 'review'
  const label = onReview ? 'Notes on the whole Review' : 'Notes on the whole Draft'

  return (
    <section
      aria-label={label}
      className={
        onReview
          ? 'border-t border-[var(--review-border)] px-3 py-2'
          : 'shrink-0 border-b border-[var(--review-border)] bg-[var(--review-surface)] px-4 py-2'
      }
    >
      <div className="flex items-center gap-2">
        <h2 className="text-[12px] font-semibold text-[var(--review-dim)]">
          {label}
          {shown.length > 0 && ` · ${shown.length}`}
        </h2>
        <button
          type="button"
          onClick={() => setComposing((open) => !open)}
          className="ml-auto shrink-0 rounded-md border border-[var(--review-border)] bg-white px-2 py-0.5 text-[12px] font-medium hover:bg-[var(--review-muted)]"
        >
          {composing ? 'Cancel' : 'Add a Note'}
        </button>
      </div>

      {composing ? (
        <Composer
          placeholder={
            onReview
              ? `Guidance for every Draft in ${subject} — "stop using em dashes anywhere"`
              : `Guidance for the whole of ${subject} — "this file needs a summary section"`
          }
          submitLabel="Add"
          withKind
          onSubmit={(body, kind) => {
            onCreate(body, kind)
            setComposing(false)
          }}
          onCancel={() => setComposing(false)}
        />
      ) : (
        shown.length === 0 && (
          <p className="mt-1 text-[12px] leading-snug text-[var(--review-dim)]">
            {onReview
              ? 'Feedback that applies to every Draft in this folder goes here.'
              : 'Feedback about this Draft as a whole goes here, rather than on a line it is not really about.'}
          </p>
        )
      )}

      {shown.length > 0 && (
        <ul className={onReview ? 'mt-2' : 'mt-2 max-h-64 overflow-y-auto'}>
          {shown.map((note) => (
            <ScopedNote
              key={note.id}
              note={note}
              onReply={onReply}
              onResolve={onResolve}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}

      {resolved.length > 0 && (
        <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[12px] text-[var(--review-dim)]">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(event) => setShowResolved(event.target.checked)}
          />
          Show {resolved.length} resolved
        </label>
      )}
    </section>
  )
}

interface ScopedNoteProps {
  note: Note
  onReply: (id: string, body: string) => void
  onResolve: (id: string) => void
  onDelete: (id: string) => void
}

function ScopedNote({ note, onReply, onResolve, onDelete }: ScopedNoteProps) {
  const [replying, setReplying] = useState(false)

  return (
    <li className="mt-2 rounded-md border border-[var(--review-border)] bg-white p-2.5 text-[13px] first:mt-0">
      <div className="mb-1 flex items-center gap-2">
        <KindTag kind={note.kind} />
        <StatusBadge status={note.status} />
        <span className="text-[11.5px] text-[var(--review-dim)]">
          {new Date(note.createdAt).toLocaleString()}
        </span>
      </div>

      <p className="whitespace-pre-wrap">{note.body}</p>

      {note.replies.length > 0 && (
        <ul className="mt-2 border-l-2 border-[var(--review-border)] pl-2">
          {note.replies.map((reply) => (
            <li key={reply.id} className="mt-1.5 first:mt-0">
              <p className="text-[11.5px] font-semibold text-[var(--review-dim)]">
                {reply.author === 'agent' ? 'Agent' : 'You'}
              </p>
              <p className="whitespace-pre-wrap text-[12.5px]">{reply.body}</p>
            </li>
          ))}
        </ul>
      )}

      {replying ? (
        <Composer
          placeholder="Reply to this Note"
          submitLabel="Reply"
          onSubmit={(body) => {
            onReply(note.id, body)
            setReplying(false)
          }}
          onCancel={() => setReplying(false)}
        />
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => setReplying(true)} className={BUTTON}>
            Reply
          </button>
          {note.status !== 'resolved' && (
            <button type="button" onClick={() => onResolve(note.id)} className={BUTTON}>
              Resolve
            </button>
          )}
          <button type="button" onClick={() => onDelete(note.id)} className={DANGER_BUTTON}>
            Delete
          </button>
        </div>
      )}
    </li>
  )
}

/** The same three colours the threads in the pane use, so a Note reads the same
 *  whatever its Scope. */
function StatusBadge({ status }: { status: Note['status'] }) {
  const colour =
    status === 'answered'
      ? 'border-[#8250df55] bg-[#fbefff] text-[#8250df]'
      : status === 'resolved'
        ? 'border-[var(--review-border)] bg-[var(--review-muted)] text-[var(--review-dim)]'
        : 'border-[#1f883d55] bg-[#dafbe1] text-[#1a7f37]'
  return (
    <span
      className={`rounded-full border px-1.5 text-[11px] font-semibold capitalize ${colour}`}
    >
      {status}
    </span>
  )
}

interface ComposerProps {
  placeholder: string
  submitLabel: string
  /** Offered only when starting a Note; a Reply has no Kind of its own. */
  withKind?: boolean
  onSubmit: (body: string, kind: NoteKind) => void
  onCancel: () => void
}

function Composer({ placeholder, submitLabel, withKind, onSubmit, onCancel }: ComposerProps) {
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<NoteKind>('fix')
  const ready = body.trim() !== ''

  return (
    <form
      className="mt-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) onSubmit(body.trim(), kind)
      }}
    >
      {withKind && <KindChooser chosen={kind} onChoose={setKind} />}
      <textarea
        autoFocus
        rows={3}
        value={body}
        aria-label={placeholder}
        placeholder={placeholder}
        onChange={(event) => setBody(event.target.value)}
        // Enter alone would fight the Markdown bodies these hold.
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && ready) {
            event.preventDefault()
            onSubmit(body.trim(), kind)
          }
          if (event.key === 'Escape') onCancel()
        }}
        className="w-full resize-y rounded-md border border-[var(--review-border)] bg-white p-2 text-[13px]"
      />
      <div className="mt-1 flex gap-2">
        <button type="submit" disabled={!ready} className={`${BUTTON} disabled:opacity-50`}>
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={QUIET_BUTTON}>
          Cancel
        </button>
      </div>
    </form>
  )
}

const KIND_HINTS: Record<NoteKind, string> = {
  fix: 'Change this.',
  question: 'Answer me in a Reply — don\u2019t edit.',
  idea: 'Optional — use your judgement.',
}

/**
 * The same Fix / Question / Idea choice the pane's composer offers. A Note that
 * asks a question wants an answer rather than an edit whether it is about one
 * sentence or the whole folder, so the Scopes have to agree on this.
 */
function KindChooser({
  chosen,
  onChoose,
}: {
  chosen: NoteKind
  onChoose: (kind: NoteKind) => void
}) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
      <div className="flex rounded-full border border-[var(--review-border)] p-0.5">
        {NOTE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={kind === chosen}
            onClick={() => onChoose(kind)}
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${
              kind === chosen
                ? 'bg-[var(--review-muted)] text-[var(--review-text)]'
                : 'text-[var(--review-dim)] hover:text-[var(--review-text)]'
            }`}
          >
            {kind}
          </button>
        ))}
      </div>
      <span className="text-[11px] text-[var(--review-dim)]">{KIND_HINTS[chosen]}</span>
    </div>
  )
}

/** Matches the Kind tag in the pane: a squared tag with a dot, not a Status pill. */
function KindTag({ kind }: { kind: NoteKind }) {
  return <span className={`cm-noteKind cm-noteKind--${kind} capitalize`}>{kind}</span>
}

const BUTTON =
  'rounded-md border border-[var(--review-border)] bg-white px-2.5 py-1 text-[12px] font-medium hover:bg-[var(--review-muted)]'
const DANGER_BUTTON = `${BUTTON} hover:border-[#d1242f] hover:bg-[#d1242f] hover:text-white`
const QUIET_BUTTON =
  'rounded-md px-2 py-0.5 text-[12px] font-medium text-[var(--review-dim)] hover:bg-[var(--review-muted)]'
