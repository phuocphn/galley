import DOMPurify from 'dompurify'
import { marked } from 'marked'

/**
 * A Note body as HTML. Bodies are Markdown, and later slices let an agent write
 * into the sidecar too, so the result is sanitised before it reaches the DOM.
 */
export function renderMarkdown(body: string): string {
  const html = marked.parse(body, { async: false, gfm: true, breaks: true })
  return DOMPurify.sanitize(html)
}
