import { useEffect, useMemo, useRef } from 'react'
import type { PreviewKind } from '../preview/document.js'
import { asPreviewMessage, type PreviewMessage } from '../preview/frame.js'
import { renderPreviewDocument } from '../preview/render.js'

interface DraftPreviewProps {
  /**
   * The Source to render: a snapshot of the buffer the reviewer is looking at,
   * taken by the Draft pane when they switched here. Deliberately not the
   * server's copy of the Draft — see `docs/adr/0005`.
   */
  source: string
  kind: PreviewKind
  /** Called when the reviewer points at something in the rendered Draft. */
  onPointedAt: (message: PreviewMessage) => void
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
 * Notes are neither shown nor created here. The Preview is for reading, and for
 * pointing back at the Source that guidance gets attached to.
 */
export function DraftPreview({ source, kind, onPointedAt }: DraftPreviewProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  const previewDocument = useMemo(() => renderPreviewDocument(source, kind), [source, kind])

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
      if (message) onPointedAt(message)
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
    />
  )
}
