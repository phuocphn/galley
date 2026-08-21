import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { buildPreviewDocument, type PreviewKind } from './document.js'
import { PREVIEW_BLOCK_ATTRIBUTE } from './frame.js'
import { markdownBlocks } from './mapping.js'

/**
 * Stamp a rendered block with which of the Draft's blocks it is.
 *
 * Done after sanitising, and after any stamp the Draft itself carried is taken
 * off it: a generated Draft may contain raw HTML, and a forged stamp would send
 * a click to a passage of the Source that has nothing to do with what the
 * reviewer pointed at. Only this pass gets to say where a block came from.
 *
 * A `<template>`'s content is inert, so nothing here loads or runs.
 */
function stamped(html: string, block: number): string {
  const holder = document.createElement('template')
  holder.innerHTML = html

  for (const forged of holder.content.querySelectorAll(`[${PREVIEW_BLOCK_ATTRIBUTE}]`)) {
    forged.removeAttribute(PREVIEW_BLOCK_ATTRIBUTE)
  }
  for (const element of Array.from(holder.content.children)) {
    element.setAttribute(PREVIEW_BLOCK_ATTRIBUTE, String(block))
  }

  return holder.innerHTML
}

/**
 * A Draft's Source as the document its Preview shows.
 *
 * Two independent things keep the result inert, because the Draft came from a
 * generator and is under review precisely because nobody has vouched for it yet:
 *
 * 1. DOMPurify drops `<script>`, `<iframe>`, `<object>`, `on*` handlers and
 *    `javascript:` URLs here, before the markup ever reaches a DOM.
 * 2. The document is served into a frame in an opaque origin whose
 *    Content-Security-Policy runs no script but the one it names a nonce for,
 *    and denies every fetch but inline styles and `data:` images. See
 *    `docs/adr/0004` for why that is two layers now rather than three.
 *
 * Markdown is parsed with GFM but without `breaks`, unlike a Note body: a Draft
 * is prose meant to be read as Markdown, not as a chat message. Markdown can
 * still carry raw HTML, so it takes the same route as an HTML Draft from there.
 *
 * A Markdown Draft is rendered block by block rather than in one call, so the
 * walk that gives each block its range in the Source is the same walk that
 * produces its markup — the two cannot disagree about where a block begins.
 */
export function renderPreviewDocument(source: string, kind: PreviewKind): string {
  if (kind === 'markdown') {
    const blocks = markdownBlocks(source).map((block, index) =>
      stamped(DOMPurify.sanitize(marked.parser([block.token], { gfm: true })), index),
    )
    return buildPreviewDocument(blocks.join('\n'))
  }

  // An HTML Draft is a whole document, and a generated page keeps most of its
  // appearance in `<style>` blocks in the head — which is much of what the
  // reviewer switched to the preview to look at. Sanitising the document rather
  // than just its body keeps them, and they are then carried into the body of
  // the preview shell, where they still apply. Reparsing is inert: the markup
  // has already been through DOMPurify, and a parsed document is not a live one.
  const sanitised = DOMPurify.sanitize(source, { WHOLE_DOCUMENT: true })
  const parsed = new DOMParser().parseFromString(sanitised, 'text/html')
  const headStyles = Array.from(parsed.head.querySelectorAll('style'), (style) => style.outerHTML)
  return buildPreviewDocument([...headStyles, parsed.body.innerHTML].join('\n'))
}
