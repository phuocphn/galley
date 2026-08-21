import { useMemo } from 'react'
import type { PreviewKind } from '../preview/document.js'
import { renderPreviewDocument } from '../preview/render.js'

interface DraftPreviewProps {
  /**
   * The Source to render: a snapshot of the buffer the reviewer is looking at,
   * taken by the Draft pane when they switched here. Deliberately not the
   * server's copy of the Draft — see `docs/adr/0005`.
   */
  source: string
  kind: PreviewKind
}

/**
 * A Draft as it reads, rather than as it is written.
 *
 * The rendered Draft lives in its own frame rather than in the app's DOM. A
 * frame gives three things a sanitised `<div>` cannot: `sandbox` turns
 * scripting off at the browser level instead of trusting the sanitiser to have
 * caught everything; the document sits in an opaque origin, so nothing it could
 * still do reaches the reviewer's Notes or the local API that writes to disk;
 * and its `<style>` blocks — which a generated HTML Draft is full of, and which
 * are part of what the reviewer came to look at — stay inside it instead of
 * restyling the editor around it. DOMPurify still runs first; the frame is the
 * layer that does not depend on being right about every payload.
 *
 * Notes are neither shown nor created here. The preview is for reading; the
 * source view is where guidance gets attached.
 */
export function DraftPreview({ source, kind }: DraftPreviewProps) {
  const previewDocument = useMemo(() => renderPreviewDocument(source, kind), [source, kind])

  return (
    <iframe
      title="Rendered preview of this Draft"
      data-testid="draft-preview"
      className="h-full w-full border-0 bg-[#eceef1]"
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={previewDocument}
    />
  )
}
