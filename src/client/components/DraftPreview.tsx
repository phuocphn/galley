import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { PreviewKind } from '../preview/document.js'
import {
  asPreviewMessage,
  composerStateMessage,
  restoreReadingMessage,
  showBlockMessage,
  type PreviewGesture,
} from '../preview/frame.js'
import { renderPreviewDocument } from '../preview/render.js'

/**
 * The reviewer arriving in the Preview, and the block of the Draft they were
 * reading in the Source as they left it.
 *
 * The block is worked out by the pane, which owns the Source's coordinates, and
 * travels with the arrival rather than being asked for when the frame is ready
 * for it: the frame may not be ready until after a document swap, by which time
 * the Source has been hidden and the question is no longer being asked of the
 * same text.
 */
export interface PreviewArrival {
  block: number | null
}

interface DraftPreviewProps {
  /**
   * The Source to render: a snapshot of the buffer the reviewer is looking at,
   * taken by the Draft pane when they switched here. Deliberately not the
   * server's copy of the Draft — see `docs/adr/0005`.
   */
  source: string
  kind: PreviewKind
  /**
   * Whether a composer is already open in the Source view behind this. The
   * frame's **Add note** button stands down while one is, rather than replacing
   * a Note being written mid-sentence.
   */
  composerOpen: boolean
  /**
   * The reviewer switching to the Preview, and the passage they were on when
   * they did. A new object every time, so switching back to a Draft's Preview
   * without having moved in the Source is still an arrival to be answered.
   *
   * Undefined until they have switched here at all, and carrying a null block
   * when the Draft has none for the two views to agree about — an HTML Draft
   * (ADR 0005), or an empty one.
   */
  arrival: PreviewArrival | undefined
  /** Called as the reviewer reads, with the block now at the top of the frame. */
  onReadingBlock: (block: number | null) => void
  /** Called when the reviewer points at something in the rendered Draft. */
  onPointedAt: (gesture: PreviewGesture) => void
}

/**
 * A Draft as it reads, rather than as it is written.
 *
 * The rendered Draft lives in its own frame rather than in the app's DOM. A
 * frame gives three things a sanitised `<div>` cannot: the document sits in an
 * opaque origin, so nothing it could still do reaches the reviewer's Notes or
 * the local API that writes to disk; the only script it may run is the one the
 * Content-Security-Policy names a nonce for, which is ours; and its `<style>`
 * blocks — which a generated HTML Draft is full of, and which are part of what
 * the reviewer came to look at — stay inside it instead of restyling the editor
 * around it. DOMPurify still runs first, on markup that has not reached a DOM;
 * the frame is the layer that does not depend on being right about every
 * payload. See `docs/adr/0004`.
 *
 * Existing Notes are not shown here — that is the reverse mapping, and is not
 * built. A new one can be begun here, though: selecting a phrase offers the
 * same **Add note** button the Source view does, and the Note it opens is
 * indistinguishable from one written there.
 */
export function DraftPreview({
  source,
  kind,
  composerOpen,
  arrival,
  onReadingBlock,
  onPointedAt,
}: DraftPreviewProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  /**
   * Where the reviewer had read to, kept across a document swap.
   *
   * It lives in this component, so it is discarded when the pane moves to
   * another Draft — which is already true of the Source view's own offset.
   */
  const readingTop = useRef(0)

  /**
   * The rendered document, memoised on the snapshot text.
   *
   * A round trip that left the Draft alone — read, jump to the Source, write a
   * Note, come back — produces a character-identical snapshot, so this does not
   * rebuild, the frame is never handed a new document, and the reading position
   * is untouched rather than restored. That is the common case working for
   * free, and it is why the nonce being fresh per render costs nothing here.
   */
  const previewDocument = useMemo(() => renderPreviewDocument(source, kind), [source, kind])

  /**
   * Whether the frame is showing the document above, rather than still parsing
   * it. A message posted to a frame mid-load is delivered to the document being
   * replaced and then thrown away with it, so anything that has to arrive waits
   * here for the load event instead.
   */
  const loaded = useRef(false)
  useEffect(() => {
    loaded.current = false
  }, [previewDocument])

  /** An arrival that has not reached the frame yet, because it was mid-load. */
  const undelivered = useRef<PreviewArrival>(undefined)

  /**
   * Tell the frame whether a composer is open, and put it back where the
   * reviewer was reading. Sent on load as well as on change, because a frame
   * that has just swapped documents has forgotten both.
   */
  const tellFrame = useCallback(() => {
    const window = frame.current?.contentWindow
    if (!window) return
    window.postMessage(composerStateMessage(composerOpen), '*')
    if (readingTop.current > 0) window.postMessage(restoreReadingMessage(readingTop.current), '*')
  }, [composerOpen])

  useEffect(tellFrame, [tellFrame])

  /**
   * Put the frame on the passage the Source view was being read at, once it has
   * a document to put it on.
   *
   * Sent after `tellFrame`, and so after the remembered reading offset, because
   * on arrival the two disagree and the derived position is the one that is
   * right: where the reviewer was left last time is not an answer to where they
   * are now. Only on arrival, though — the remembered offset is what a document
   * swap needs, and an agent rewriting the Draft while it is being read must
   * leave the reader near where they had read to rather than throw them back to
   * wherever they came in.
   */
  const putOnPassage = useCallback(() => {
    const window = frame.current?.contentWindow
    const arriving = undelivered.current
    if (!arriving || !loaded.current || !window) return

    undelivered.current = undefined
    if (arriving.block !== null) window.postMessage(showBlockMessage(arriving.block), '*')
  }, [])

  useEffect(() => {
    if (!arrival) return
    undelivered.current = arrival
    putOnPassage()
  }, [arrival, putOnPassage])

  /** The frame has a document again: it has forgotten everything it was told. */
  const onLoad = useCallback(() => {
    loaded.current = true
    tellFrame()
    putOnPassage()
  }, [tellFrame, putOnPassage])

  /**
   * What the frame says is untrusted input, and arrives on a window every page
   * on the machine can post to. The frame has no `allow-same-origin`, so its
   * origin is opaque and `event.origin` says only "null" — the sending window's
   * identity is the thing that can be checked, and it is checked before the
   * message is so much as read.
   */
  useEffect(() => {
    function receive(event: MessageEvent): void {
      if (!frame.current || event.source !== frame.current.contentWindow) return
      const message = asPreviewMessage(event.data)
      if (!message) return

      // Where they have read to in pixels is this component's business, and
      // outlives only a document swap. Which block they have read to is the
      // pane's, because it is the Source that has to be scrolled to it.
      if (message.kind === 'scrolled') {
        readingTop.current = message.top
        onReadingBlock(message.block)
        return
      }
      onPointedAt(message)
    }

    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [onPointedAt, onReadingBlock])

  return (
    <iframe
      ref={frame}
      title="Rendered preview of this Draft"
      data-testid="draft-preview"
      className="h-full w-full border-0 bg-[#eceef1]"
      // Enough to hear a click and answer it, and nothing more: without
      // `allow-same-origin` the frame stays in an opaque origin, unable to
      // reach the app's DOM, its storage, or the API that writes to disk.
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={previewDocument}
      onLoad={onLoad}
    />
  )
}
