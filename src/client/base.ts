/** Matches `REVIEW_PREFIX` on the Desk. */
const REVIEW_PREFIX = '/r'

/**
 * The path this Review is served under.
 *
 * One Desk holds every Review, each under its own path (`docs/adr/0008`), so
 * the client cannot ask for `/api/review` and expect to get the Review the
 * reviewer is looking at. It reads which one that is from the URL it was loaded
 * from, which means the page and its data cannot disagree about it.
 */
export function reviewBase(pathname: string = window.location.pathname): string {
  if (!pathname.startsWith(`${REVIEW_PREFIX}/`)) return ''

  const [id] = pathname.slice(REVIEW_PREFIX.length + 1).split('/')
  return id ? `${REVIEW_PREFIX}/${id}` : ''
}
