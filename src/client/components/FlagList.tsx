import { useState } from 'react'
import type { Flag } from '../../shared/types.js'

interface FlagListProps {
  /** Every Flag in the Review, grouped here by the Draft they are on. */
  flags: Flag[]
  /** The Draft currently open, whose Flags are the located ones. */
  selectedPath: string | undefined
  /**
   * Which of the open Draft's Flags have lost the text they were about. Only
   * the open Draft can answer this: locating the rest would mean reading every
   * Draft in the folder on every refresh — see `docs/adr/0010`.
   */
  orphanedIds: ReadonlySet<string>
  /** Go to the Flag: select its Draft, and put the Source on the passage. */
  onGo: (flag: Flag) => void
  onReason: (id: string, reason: string) => void
  onPromote: (flag: Flag) => void
  onClear: (id: string) => void
}

/**
 * The Flag list: every passage in the Review marked to come back to.
 *
 * It lives in the sidebar rather than behind a tab because it is about the
 * whole Review, not the Draft in front of you — the point of a list like this
 * is to be glanceable while you read something else. Flags are grouped by
 * Draft; the label is the reason where one was written and the anchored text
 * otherwise, because a Flag is raised in one gesture and the words are optional.
 */
export function FlagList({
  flags,
  selectedPath,
  orphanedIds,
  onGo,
  onReason,
  onPromote,
  onClear,
}: FlagListProps) {
  const byDraft = new Map<string, Flag[]>()
  for (const flag of flags) {
    const own = byDraft.get(flag.draftPath)
    if (own) own.push(flag)
    else byDraft.set(flag.draftPath, [flag])
  }

  return (
    <section
      aria-label="Flags"
      className="flex max-h-[40%] shrink-0 flex-col border-t border-[var(--review-border)]"
    >
      <h2 className="shrink-0 px-3 py-2 text-[12px] font-semibold text-[var(--review-dim)]">
        Flags
        {flags.length > 0 && ` · ${flags.length}`}
      </h2>

      {flags.length === 0 ? (
        <p className="px-3 pb-2 text-[12px] leading-snug text-[var(--review-dim)]">
          Select a passage and press ⚑ to mark it for a second look. Flags stay here and never
          reach the agent.
        </p>
      ) : (
        // Its own scroller: a long list must not push the Draft list out of reach.
        <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {[...byDraft].map(([draftPath, own]) => (
            <li key={draftPath} className="mt-2 first:mt-0">
              <p
                className={`truncate text-[11px] font-semibold ${
                  draftPath === selectedPath
                    ? 'text-[var(--review-text)]'
                    : 'text-[var(--review-dim)]'
                }`}
                title={draftPath}
              >
                {draftPath}
              </p>
              <ul>
                {own.map((flag) => (
                  <FlagRow
                    key={flag.id}
                    flag={flag}
                    orphaned={orphanedIds.has(flag.id)}
                    onGo={() => onGo(flag)}
                    onReason={(reason) => onReason(flag.id, reason)}
                    onPromote={() => onPromote(flag)}
                    onClear={() => onClear(flag.id)}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

interface FlagRowProps {
  flag: Flag
  orphaned: boolean
  onGo: () => void
  onReason: (reason: string) => void
  onPromote: () => void
  onClear: () => void
}

function FlagRow({ flag, orphaned, onGo, onReason, onPromote, onClear }: FlagRowProps) {
  const [writing, setWriting] = useState(false)

  // The reason where there is one, the words themselves where there is not: a
  // Flag is one gesture, so most of them are only ever the passage.
  const label = flag.reason ?? flag.anchor.text

  return (
    <li className="mt-1 rounded-md border border-transparent px-1 py-0.5 hover:border-[var(--review-border)] hover:bg-white">
      <div className="flex items-start gap-1.5">
        <span aria-hidden className="mt-[1px] shrink-0 text-[11px] text-[#9a6700]">
          ⚑
        </span>
        <button
          type="button"
          onClick={onGo}
          title={orphaned ? 'This passage is no longer in the Draft' : flag.anchor.text}
          className={`min-w-0 flex-1 truncate text-left text-[12px] ${
            orphaned ? 'text-[var(--review-dim)] line-through' : ''
          }`}
        >
          {label}
        </button>
      </div>

      {orphaned && (
        <p className="pl-[18px] text-[11px] text-[#7d4e00]">
          this passage is gone — the agent rewrote it
        </p>
      )}

      {writing ? (
        <ReasonBox
          initial={flag.reason ?? ''}
          onSubmit={(reason) => {
            onReason(reason)
            setWriting(false)
          }}
          onCancel={() => setWriting(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-1 pl-[18px]">
          {/* An Orphaned Flag offers only clearing. There is no passage left to
              write a Note on and none to re-attach to: a Flag owes nobody
              anything, so the one thing left to do with it is be done with it.
              See `docs/adr/0010`. */}
          {!orphaned && (
            <>
              <RowButton onClick={() => setWriting(true)}>
                {flag.reason ? 'Edit why' : 'Why?'}
              </RowButton>
              {/* Promotion opens the composer over the passage; the Note is
                  written first and the Flag cleared second, so a failure
                  between the two leaves a stray Flag, never a lost Note. */}
              <RowButton onClick={onPromote}>→ Note</RowButton>
            </>
          )}
          <RowButton onClick={onClear} title="Clear this Flag. It is not kept.">
            ✓
          </RowButton>
        </div>
      )}
    </li>
  )
}

/** One line, because a Flag's reason is a reminder and not a Note. */
function ReasonBox({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string
  onSubmit: (reason: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState(initial)

  return (
    <form
      className="mt-1 pl-[18px]"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(reason.trim())
      }}
    >
      <input
        autoFocus
        value={reason}
        aria-label="Why this passage is flagged"
        placeholder="why come back to this?"
        onChange={(event) => setReason(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
        }}
        className="w-full rounded-md border border-[var(--review-border)] bg-white px-1.5 py-0.5 text-[12px]"
      />
    </form>
  )
}

function RowButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title?: string
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded px-1 text-[11px] font-medium text-[var(--review-dim)] hover:bg-[var(--review-muted)] hover:text-[var(--review-text)]"
    >
      {children}
    </button>
  )
}
