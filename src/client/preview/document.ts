import type { DraftExtension } from '../../shared/types.js'

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
 * yet, so the preview is inert: nothing executes, and nothing leaves the
 * machine. `default-src 'none'` denies every fetch the document could start —
 * scripts, stylesheets, images, fonts, media, frames, XHR — and the two
 * exceptions below are the smallest set that keeps a preview worth looking at:
 *
 * - `style-src 'unsafe-inline'` lets the preview's own stylesheet and a Draft's
 *   `<style>` blocks and `style=` attributes apply. It permits no *fetch*; an
 *   external `url()` in a stylesheet is still an image or font load, and both
 *   are denied.
 * - `img-src data:` lets a Draft embed inline images without reaching the
 *   network. A remote `<img src="https://…">` is blocked and shows as broken,
 *   which is the honest result: this preview does not make requests.
 */
export const PREVIEW_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

/** Typography for the preview. A Draft's own `<style>` comes later, and wins. */
const PREVIEW_STYLESHEET = `
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
 * The whole document handed to the preview frame, as a string.
 *
 * Kept free of the DOM and of the sanitiser so the shell itself — the policy,
 * the ordering, the link handling — can be read and tested on its own.
 *
 * `<base target="_blank">` sends any link the reviewer clicks to a new browsing
 * context, which the frame's `sandbox` then refuses to open. The click does
 * nothing instead of navigating the preview away to a remote page.
 */
export function buildPreviewDocument(bodyHtml: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CONTENT_SECURITY_POLICY}">`,
    '<base target="_blank">',
    `<style>${PREVIEW_STYLESHEET}</style>`,
    '</head>',
    '<body>',
    bodyHtml,
    '</body>',
    '</html>',
  ].join('\n')
}
