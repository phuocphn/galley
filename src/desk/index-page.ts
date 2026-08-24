import { reviewPath } from './address.js'

/** One line of the index: a Review, open or merely remembered. */
export interface IndexEntry {
  id: string
  root: string
  open: boolean
}

function escaped(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character,
  )
}

/**
 * What is on the Desk.
 *
 * Rendered here rather than in the client because it is a list of links and
 * nothing else — giving `App.tsx` a second mode to carry would cost more than
 * this page is worth. A remembered-but-closed Review is listed too: visiting it
 * reopens it, which is the whole point of the registry.
 */
export function indexPage(entries: IndexEntry[]): string {
  const rows = entries
    .map((entry) => {
      const state = entry.open ? 'open' : 'closed'
      return `      <li>
        <a href="${escaped(reviewPath(entry.id))}">
          <span class="name">${escaped(entry.id)}</span>
          <span class="root">${escaped(entry.root)}</span>
        </a>
        <span class="state ${state}">${state}</span>
      </li>`
    })
    .join('\n')

  const body =
    entries.length === 0
      ? `    <p class="empty">No Reviews yet. Run <code>galley ./some-folder</code>.</p>`
      : `    <ul>\n${rows}\n    </ul>`

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>galley</title>
    <style>
      :root { color-scheme: light dark; --line: #8883; --dim: #8886; }
      body { margin: 0; padding: 3rem 1.5rem; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; }
      main { max-width: 46rem; margin: 0 auto; }
      h1 { font-size: 1.1rem; margin: 0 0 0.25rem; }
      p.lead { margin: 0 0 2rem; color: var(--dim); }
      ul { list-style: none; margin: 0; padding: 0; }
      li { display: flex; align-items: baseline; gap: 1rem;
           padding: 0.75rem 0; border-top: 1px solid var(--line); }
      li a { flex: 1; text-decoration: none; color: inherit; display: flex;
             flex-direction: column; gap: 0.15rem; }
      li a:hover .name { text-decoration: underline; }
      .name { font-weight: 600; }
      .root { color: var(--dim); font-size: 0.85em;
              font-family: ui-monospace, SFMono-Regular, monospace; }
      .state { font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.04em;
               color: var(--dim); }
      .state.open { color: #1a7f37; }
      .empty { color: var(--dim); }
      code { font-family: ui-monospace, SFMono-Regular, monospace; }
    </style>
  </head>
  <body>
    <main>
    <h1>galley</h1>
    <p class="lead">Reviews on this Desk. A closed one reopens when you visit it.</p>
${body}
    </main>
  </body>
</html>
`
}
