import type { Anchor, ResolvedNote } from '../../shared/types.js'

/** Losing an Anchor is what orphans a Note, so an Orphaned one always had one. */
export type OrphanedNote = ResolvedNote & { anchor: Anchor }

interface OrphanedNotesProps {
  notes: OrphanedNote[]
  /** The Note currently waiting for the reviewer to pick new text, if any. */
  reattaching: string | undefined
  onReattach: (id: string) => void
  onCancelReattach: () => void
  onResolve: (id: string) => void
  onDelete: (id: string) => void
}

/**
 * Notes whose Anchor no longer exists in the Draft.
 *
 * An orphan usually means the agent *did* act on the Note and wrote the passage
 * away — so this needs one glance and one click. What it must never do is
 * vanish, or quietly point at the wrong sentence, so each one is shown at the
 * top of the Draft quoting the text it used to be about.
 */
export function OrphanedNotes({
  notes,
  reattaching,
  onReattach,
  onCancelReattach,
  onResolve,
  onDelete,
}: OrphanedNotesProps) {
  if (notes.length === 0) return null

  return (
    <section
      aria-label="Orphaned Notes"
      className="shrink-0 border-b border-[#d4a72c66] bg-[#fff8c5]"
    >
      <h2 className="px-4 pt-2 text-[12px] font-semibold text-[#7d4e00]">
        {notes.length === 1
          ? '1 Note has lost the text it was about'
          : `${notes.length} Notes have lost the text they were about`}
      </h2>
      <p className="px-4 pb-2 text-[12px] text-[#7d4e00]">
        Usually this means the agent rewrote that passage. Re-attach a Note if it still
        applies, or resolve it if it's handled.
      </p>

      <ul className="max-h-64 overflow-y-auto px-4 pb-3">
        {notes.map((note) => {
          const picking = reattaching === note.id
          return (
            <li
              key={note.id}
              className="mt-2 rounded-md border border-[#d4a72c66] bg-white p-2.5 text-[13px] first:mt-0"
            >
              <p className="mb-1.5 text-[12px] text-[var(--review-dim)]">
                was about{' '}
                <q className="font-mono text-[11.5px] text-[var(--review-text)]">
                  {truncate(note.anchor.text)}
                </q>{' '}
                on {note.anchor.startLine === note.anchor.endLine
                  ? `line ${note.anchor.startLine}`
                  : `lines ${note.anchor.startLine}–${note.anchor.endLine}`}
              </p>

              <p className="whitespace-pre-wrap">{note.body}</p>

              {picking ? (
                <p className="mt-2 flex items-center gap-2 text-[12px] font-semibold text-[#0969da]">
                  Now select the text this Note is about, or click a line number.
                  <button type="button" onClick={onCancelReattach} className={QUIET_BUTTON}>
                    Cancel
                  </button>
                </p>
              ) : (
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => onReattach(note.id)} className={BUTTON}>
                    Re-attach
                  </button>
                  <button type="button" onClick={() => onResolve(note.id)} className={BUTTON}>
                    Resolve
                  </button>
                  <button type="button" onClick={() => onDelete(note.id)} className={DANGER_BUTTON}>
                    Delete
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Enough of the lost text to recognise it, without flooding the banner. */
function truncate(text: string, limit = 120): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit)}…`
}

const BUTTON =
  'rounded-md border border-[var(--review-border)] bg-white px-2.5 py-1 text-[12px] font-medium hover:bg-[var(--review-muted)]'
const DANGER_BUTTON = `${BUTTON} hover:border-[#d1242f] hover:bg-[#d1242f] hover:text-white`
const QUIET_BUTTON = 'rounded-md px-2 py-0.5 text-[12px] font-medium text-[var(--review-dim)] hover:bg-[var(--review-muted)]'
