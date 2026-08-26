import { SIDEBAR_SHORTCUT } from '../useCollapsibleSidebar.js'

interface SidebarToggleProps {
  collapsed: boolean
  /** Outstanding Notes that are only reachable from the sidebar. */
  hiddenReviewNotes: number
  /** Flags, which live in the sidebar too and go out of reach with it. */
  hiddenFlags: number
  onToggle: () => void
}

/**
 * Shows and hides the Draft list.
 *
 * It sits in the header rather than in the sidebar, so it stays in the same
 * place whether the sidebar is there or not — a control that moves when you use
 * it is a control you have to hunt for.
 */
export function SidebarToggle({
  collapsed,
  hiddenReviewNotes,
  hiddenFlags,
  onToggle,
}: SidebarToggleProps) {
  const label = collapsed ? 'Show the Draft list' : 'Hide the Draft list'
  // Two different things, counted apart: a Note is work the agent will do, a
  // Flag is work only the reviewer will. One number would blur them.
  const hidden = [
    hiddenReviewNotes > 0
      ? `${hiddenReviewNotes} outstanding ${hiddenReviewNotes === 1 ? 'Note' : 'Notes'} on the whole Review`
      : undefined,
    hiddenFlags > 0 ? `${hiddenFlags} ${hiddenFlags === 1 ? 'Flag' : 'Flags'}` : undefined,
  ].filter(Boolean)

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-controls="review-sidebar"
      aria-label={label}
      title={`${label} (${SIDEBAR_SHORTCUT})`}
      className="relative -ml-1 flex shrink-0 items-center rounded-md p-1 text-[var(--review-dim)] hover:bg-[var(--review-muted)] hover:text-[var(--review-text)]"
    >
      <SidebarIcon collapsed={collapsed} />
      {collapsed && hidden.length > 0 && (
        <span
          // Notes on the whole Review and every Flag live in the sidebar, so
          // collapsing it puts them out of reach. The count keeps them from
          // being forgotten.
          title={hidden.join(', and ')}
          className="absolute -right-0.5 -top-0.5 flex items-center gap-0.5 rounded-full bg-[var(--review-accent)] px-1 text-center text-[10px] font-semibold leading-[14px] text-white"
        >
          {hiddenReviewNotes > 0 && hiddenReviewNotes}
          {hiddenFlags > 0 && (
            <>
              {hiddenReviewNotes > 0 && '·'}
              <span aria-hidden>⚑</span>
              {hiddenFlags}
            </>
          )}
        </span>
      )}
    </button>
  )
}

function SidebarIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="1.25"
        y="2.25"
        width="13.5"
        height="11.5"
        rx="1.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* Filled when the panel is showing, hollow when it isn't. */}
      <rect
        x="1.25"
        y="2.25"
        width="4.5"
        height="11.5"
        fill={collapsed ? 'none' : 'currentColor'}
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  )
}
