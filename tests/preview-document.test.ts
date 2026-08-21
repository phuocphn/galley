import { describe, expect, it } from 'vitest'
import {
  buildPreviewDocument,
  previewContentSecurityPolicy,
  previewKindFor,
} from '../src/client/preview/document.js'

/**
 * The Preview shell, which is plain string assembly and so can be checked here.
 * What the browser then does with it — running only the script the policy names
 * a nonce for, refusing the fetches it denies — is the browser's contract, not
 * something this suite can drive.
 *
 * These assertions are load-bearing rather than belt-and-braces. `docs/adr/0004`
 * traded the frame's scripting-off guarantee for a nonce, which leaves DOMPurify
 * as one of two layers rather than one of three: a later edit that loosened the
 * policy — an added `'unsafe-inline'`, a host in a source list — would be
 * exploitable in a way the frame that shipped before it was not.
 */

/** The policy the built document actually carries, as the frame will read it. */
function policyOf(document: string): string {
  return /content="([^"]*)"/.exec(document)?.[1] ?? ''
}

/** The nonce that policy names. */
function nonceOf(document: string): string {
  return /'nonce-([^']*)'/.exec(policyOf(document))?.[1] ?? ''
}

describe('the preview document', () => {
  it('is offered for Markdown and HTML Drafts, and not for .txt', () => {
    expect(previewKindFor('.md')).toBe('markdown')
    expect(previewKindFor('.html')).toBe('html')
    expect(previewKindFor('.txt')).toBeNull()
  })

  // Rendering LaTeX means running it, and galley does not execute a Draft.
  // See `docs/adr/0006`.
  it('is not offered for LaTeX Drafts', () => {
    expect(previewKindFor('.tex')).toBeNull()
    expect(previewKindFor('.bib')).toBeNull()
  })

  it('carries the rendered Draft in its body', () => {
    const document = buildPreviewDocument('<h1>A Draft</h1>', 'markdown')
    expect(document.startsWith('<!doctype html>')).toBe(true)
    expect(document).toContain('<h1>A Draft</h1>')
  })

  it('denies every fetch but inline styles and data: images', () => {
    const policy = policyOf(buildPreviewDocument('', 'markdown'))
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain('img-src data:')
    expect(policy).toContain("form-action 'none'")
    // No source list may name a host, or the Preview could reach the network.
    expect(policy).not.toMatch(/https?:|\*/)
  })

  it('runs no script but the one it names a nonce for', () => {
    const nonce = 'abc123'
    const policy = previewContentSecurityPolicy(nonce)

    expect(policy).toContain(`script-src 'nonce-${nonce}'`)
    // Nothing else may run: no `'unsafe-inline'`, no `'unsafe-eval'`, no host,
    // and no `'self'` — a `<script>` the sanitiser missed carries no nonce.
    expect(/script-src ([^;]*)/.exec(policy)?.[1]).toBe(`'nonce-${nonce}'`)
  })

  it('mints a fresh nonce for every rendered document', () => {
    // A nonce that outlived its document would be a value a Draft could come to
    // carry, and not knowing it is the whole of what makes it work.
    const first = nonceOf(buildPreviewDocument('<p>A Draft</p>', 'markdown'))
    const second = nonceOf(buildPreviewDocument('<p>A Draft</p>', 'markdown'))

    expect(first).not.toBe('')
    expect(first).not.toBe(second)
  })

  it('carries that nonce on its own script and on nothing else', () => {
    const document = buildPreviewDocument('<script>steal()</script><p>A Draft</p>', 'markdown')
    const nonce = nonceOf(document)

    const nonced = document.match(/nonce="([^"]*)"/g) ?? []
    expect(nonced).toEqual([`nonce="${nonce}"`])
  })

  it('states the policy before anything that could load', () => {
    const document = buildPreviewDocument('<img src="https://example.com/a.png">', 'markdown')
    const policy = document.indexOf('Content-Security-Policy')
    expect(policy).toBeGreaterThan(-1)
    expect(policy).toBeLessThan(document.indexOf('<style>'))
    expect(policy).toBeLessThan(document.indexOf('<body>'))
  })

  it('sends links to a browsing context the frame is not allowed to open', () => {
    expect(buildPreviewDocument('', 'markdown')).toContain('<base target="_blank">')
  })

  it('leaves an HTML Draft its own width, and holds a Markdown one to a column', () => {
    // Markdown renders to bare tags and has no measure of its own, so the shell
    // supplies one. A generated HTML page brings its own layout — often wider
    // than a reading column, and often a grid — and a `max-width` it never
    // asked for is not a rule it knows to override.
    expect(buildPreviewDocument('<p>A Draft</p>', 'markdown')).toContain('max-width')
    expect(buildPreviewDocument('<p>A Draft</p>', 'html')).not.toContain('max-width')
  })

  it('gives an HTML Draft a page to sit on rather than the pane showing through', () => {
    expect(buildPreviewDocument('', 'html')).toContain('background: #ffffff')
  })

  it('states the policy before the script it permits', () => {
    const document = buildPreviewDocument('<p>A Draft</p>', 'markdown')
    expect(document.indexOf('Content-Security-Policy')).toBeLessThan(document.indexOf('<script'))
  })
})
