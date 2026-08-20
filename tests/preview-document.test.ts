import { describe, expect, it } from 'vitest'
import {
  buildPreviewDocument,
  previewKindFor,
  PREVIEW_CONTENT_SECURITY_POLICY,
} from '../src/client/preview/document.js'

/**
 * The preview shell, which is plain string assembly and so can be checked here.
 * What the browser then does with it — refusing to run scripts in a `sandbox`
 * frame, refusing the fetches this policy denies — is the browser's contract,
 * not something this suite can drive.
 */
describe('the preview document', () => {
  it('is offered for Markdown and HTML Drafts, and not for .txt', () => {
    expect(previewKindFor('.md')).toBe('markdown')
    expect(previewKindFor('.html')).toBe('html')
    expect(previewKindFor('.txt')).toBeNull()
  })

  it('carries the rendered Draft in its body', () => {
    const document = buildPreviewDocument('<h1>A Draft</h1>')
    expect(document.startsWith('<!doctype html>')).toBe(true)
    expect(document).toContain('<h1>A Draft</h1>')
  })

  it('denies every fetch but inline styles and data: images', () => {
    expect(PREVIEW_CONTENT_SECURITY_POLICY).toContain("default-src 'none'")
    expect(PREVIEW_CONTENT_SECURITY_POLICY).toContain('img-src data:')
    expect(PREVIEW_CONTENT_SECURITY_POLICY).toContain("form-action 'none'")
    // No source list may name a host, or the preview could reach the network.
    expect(PREVIEW_CONTENT_SECURITY_POLICY).not.toMatch(/https?:|\*/)
    // Scripts get no directive of their own, so they fall back to `none`.
    expect(PREVIEW_CONTENT_SECURITY_POLICY).not.toContain('script-src')
  })

  it('states the policy before anything that could load', () => {
    const document = buildPreviewDocument('<img src="https://example.com/a.png">')
    const policy = document.indexOf('Content-Security-Policy')
    expect(policy).toBeGreaterThan(-1)
    expect(policy).toBeLessThan(document.indexOf('<style>'))
    expect(policy).toBeLessThan(document.indexOf('<body>'))
  })

  it('sends links to a browsing context the frame is not allowed to open', () => {
    expect(buildPreviewDocument('')).toContain('<base target="_blank">')
  })
})
