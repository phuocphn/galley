import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { PreviewKind } from '../preview/document.js'
import {
  asPreviewMessage,
  composerStateMessage,
  restoreReadingMessage,
  type PreviewGesture,
} from '../preview/frame.js'
import { renderPreviewDocument } from '../preview/render.js'

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
export function DraftPreview({ source, kind, composerOpen, onPointedAt }: DraftPreviewProps) {
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

      // Where they have read to is this component's business, not the pane's.
      if (message.kind === 'scrolled') {
        readingTop.current = message.top
        return
      }
      onPointedAt(message)
    }

    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [onPointedAt])

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
      onLoad={tellFrame}
    />
  )
}
