import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { buildPreviewDocument, type PreviewKind } from './document.js'

/**
 * A Draft's source as the document its rendered preview shows.
 *
 * Three independent things keep the result inert, because the Draft came from a
 * generator and is under review precisely because nobody has vouched for it yet:
 *
 * 1. DOMPurify drops `<script>`, `<iframe>`, `<object>`, `on*` handlers and
 *    `javascript:` URLs here, before the markup ever reaches a DOM.
 * 2. The document is served into a frame with an empty `sandbox`, so even
 *    markup that survived sanitising runs in an opaque origin with scripting
 *    switched off entirely.
 * 3. Its Content-Security-Policy denies every fetch but inline styles and
 *    `data:` images, so the preview makes no network requests.
 *
 * Markdown is parsed with GFM but without `breaks`, unlike a Note body: a Draft
 * is prose meant to be read as Markdown, not as a chat message. Markdown can
 * still carry raw HTML, so it takes the same route as an HTML Draft from there.
 */
export function renderPreviewDocument(content: string, kind: PreviewKind): string {
  if (kind === 'markdown') {
    const rendered = marked.parse(content, { async: false, gfm: true })
    return buildPreviewDocument(DOMPurify.sanitize(rendered))
  }

  // An HTML Draft is a whole document, and a generated page keeps most of its
  // appearance in `<style>` blocks in the head — which is much of what the
  // reviewer switched to the preview to look at. Sanitising the document rather
  // than just its body keeps them, and they are then carried into the body of
  // the preview shell, where they still apply. Reparsing is inert: the markup
  // has already been through DOMPurify, and a parsed document is not a live one.
  const sanitised = DOMPurify.sanitize(content, { WHOLE_DOCUMENT: true })
  const parsed = new DOMParser().parseFromString(sanitised, 'text/html')
  const headStyles = Array.from(parsed.head.querySelectorAll('style'), (style) => style.outerHTML)
  return buildPreviewDocument([...headStyles, parsed.body.innerHTML].join('\n'))
}
