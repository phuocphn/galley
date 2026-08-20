import { SIDEBAR_SHORTCUT } from '../useCollapsibleSidebar.js'

interface SidebarToggleProps {
  collapsed: boolean
  /** Outstanding Notes that are only reachable from the sidebar. */
  hiddenReviewNotes: number
  onToggle: () => void
}

/**
 * Shows and hides the Draft list.
 *
 * It sits in the header rather than in the sidebar, so it stays in the same
 * place whether the sidebar is there or not — a control that moves when you use
 * it is a control you have to hunt for.
 */
export function SidebarToggle({ collapsed, hiddenReviewNotes, onToggle }: SidebarToggleProps) {
  const label = collapsed ? 'Show the Draft list' : 'Hide the Draft list'

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
      {collapsed && hiddenReviewNotes > 0 && (
        <span
          // Notes on the whole Review live in the sidebar, so collapsing it puts
          // them out of reach. The count keeps them from being forgotten.
          title={`${hiddenReviewNotes} outstanding ${
            hiddenReviewNotes === 1 ? 'Note' : 'Notes'
          } on the whole Review`}
          className="absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full bg-[var(--review-accent)] px-1 text-center text-[10px] font-semibold leading-[14px] text-white"
        >
          {hiddenReviewNotes}
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
