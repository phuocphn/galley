import type { DraftExtension } from '../../shared/types.js'
import { PREVIEW_FRAME_SCRIPT } from './frame.js'

/** How a Draft's source is turned into a rendered preview. */
export type PreviewKind = 'markdown' | 'html'

/**
 * Which rendered preview a Draft gets, or null when it has none. A `.txt` Draft
 * reads the same rendered as it does in source, so it is offered no toggle.
 */
export function previewKindFor(extension: DraftExtension): PreviewKind | null {
  switch (extension) {
    case '.md':
      return 'markdown'
    case '.html':
      return 'html'
    case '.txt':
      return null
  }
}

/**
 * The policy the previewed Draft is rendered under.
 *
 * A Draft is AI-generated and under review precisely because it is not trusted
 * yet, so the Preview runs nothing of its own and reaches nothing off the
 * machine. `default-src 'none'` denies every fetch the document could start —
 * scripts, stylesheets, images, fonts, media, frames, XHR — and the three
 * exceptions below are the smallest set that keeps a Preview worth looking at
 * and able to say what the reviewer pointed at:
 *
 * - `script-src 'nonce-…'` names a nonce minted for this one document, and
 *   carried by exactly one `<script>`: ours. A `<script>` in the Draft has no
 *   nonce, so it does not run even if it reached the frame — see
 *   `docs/adr/0004`. `allow-same-origin` is withheld on the frame, so what our
 *   script can do with the capability is `postMessage` and nothing else.
 * - `style-src 'unsafe-inline'` lets the Preview's own stylesheet and a Draft's
 *   `<style>` blocks and `style=` attributes apply. It permits no *fetch*; an
 *   external `url()` in a stylesheet is still an image or font load, and both
 *   are denied.
 * - `img-src data:` lets a Draft embed inline images without reaching the
 *   network. A remote `<img src="https://…">` is blocked and shows as broken,
 *   which is the honest result: this Preview does not make requests.
 *
 * No source list names a host, so nothing here can be fetched from anywhere.
 */
export function previewContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    'img-src data:',
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
}

/**
 * A fresh nonce for one rendered document.
 *
 * Per document rather than per session: a nonce that outlived the document it
 * was minted for would be a value a Draft could come to carry, and the whole
 * point of it is that the Draft cannot know it.
 */
function mintNonce(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

/**
 * Typography for a Markdown Preview.
 *
 * Markdown renders to bare tags with no styling of its own, so the shell has to
 * supply the whole of how it reads — including the measure, which is why the
 * body is held to a column rather than run to the width of the pane.
 *
 * A Draft's own `<style>` comes later and wins, which is enough for the rules
 * it overrides and no help at all for the ones it never mentions. That is why
 * an HTML Draft gets a different shell rather than this one plus its own: a
 * generated page brings its own layout, and a `max-width` it never asked for is
 * not a rule it knows to override.
 */
const MARKDOWN_STYLESHEET = `
  html {
    background: #eceef1;
  }
  body {
    box-sizing: border-box;
    max-width: 780px;
    margin: 0 auto;
    padding: 28px 32px 64px;
    min-height: 100%;
    background: #ffffff;
    color: #1f2328;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.65;
    overflow-wrap: break-word;
  }
  h1, h2, h3, h4, h5, h6 { margin: 24px 0 12px; line-height: 1.3; font-weight: 600; }
  h1 { font-size: 26px; }
  h2 { font-size: 20px; padding-bottom: 6px; border-bottom: 1px solid #d1d9e0; }
  h3 { font-size: 17px; }
  p, ul, ol, blockquote, table, pre { margin: 0 0 14px; }
  ul, ol { padding-left: 24px; }
  ul { list-style: disc; }
  ol { list-style: decimal; }
  li { margin: 2px 0; }
  a { color: #0969da; }
  blockquote {
    padding: 0 14px;
    border-left: 3px solid #d1d9e0;
    color: #59636e;
  }
  code {
    padding: 1px 5px;
    border-radius: 4px;
    background: #f0f2f5;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px;
  }
  pre {
    padding: 12px 14px;
    border-radius: 6px;
    background: #f6f8fa;
    overflow-x: auto;
  }
  pre code { padding: 0; background: none; }
  table { border-collapse: collapse; }
  th, td { padding: 6px 12px; border: 1px solid #d1d9e0; }
  th { background: #f6f8fa; }
  img { max-width: 100%; }
  hr { height: 1px; margin: 24px 0; border: 0; background: #d1d9e0; }
`

/**
 * The shell an HTML Draft is rendered in: almost nothing.
 *
 * A generated page is a whole document. It carries its own measure, its own
 * grid, its own background — much of what the reviewer switched to the Preview
 * to look at — and the shell's job is to stay out of the way of all of it. The
 * one rule left is a background, so that a Draft which sets none reads as a
 * page rather than showing the pane's grey through it.
 */
const HTML_STYLESHEET = `
  html {
    background: #ffffff;
  }
`

/**
 * The whole document handed to the Preview frame, as a string.
 *
 * Kept free of the DOM and of the sanitiser so the shell itself — the policy,
 * the ordering, the one script — can be read and tested on its own.
 *
 * `<base target="_blank">` sends any link the reviewer clicks to a new browsing
 * context, which the frame's `sandbox` then refuses to open. The injected
 * listener swallows the click before that anyway, and reports the passage
 * instead; the `<base>` is what makes a link that somehow escaped it inert
 * rather than a navigation away from the Preview.
 *
 * The script goes last, after the markup it listens to, and carries the nonce
 * the policy names. It is the only element in the document that does.
 */
export function buildPreviewDocument(bodyHtml: string, kind: PreviewKind): string {
  const nonce = mintNonce()
  const stylesheet = kind === 'markdown' ? MARKDOWN_STYLESHEET : HTML_STYLESHEET

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${previewContentSecurityPolicy(nonce)}">`,
    '<base target="_blank">',
    `<style>${stylesheet}</style>`,
    '</head>',
    '<body>',
    bodyHtml,
    `<script nonce="${nonce}">${PREVIEW_FRAME_SCRIPT}</script>`,
    '</body>',
    '</html>',
  ].join('\n')
}
