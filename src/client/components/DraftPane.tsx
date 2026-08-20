import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import type { DraftExtension } from '../../shared/types.js'

/** Light syntax highlighting per format. `.txt` gets none, by design. */
function languageFor(extension: DraftExtension): Extension[] {
  switch (extension) {
    case '.md':
      return [markdown()]
    case '.html':
      return [html()]
    case '.txt':
      return []
  }
}

interface DraftPaneProps {
  path: string
  extension: DraftExtension
  content: string
}

export function DraftPane({ path, extension, content }: DraftPaneProps) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!host.current) return

    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          EditorView.lineWrapping,
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          ...languageFor(extension),
          // Drafts become editable in a later slice; for now, read-only.
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ],
      }),
    })

    return () => view.destroy()
  }, [path, extension, content])

  return <div ref={host} className="h-full overflow-hidden" data-testid="draft-pane" />
}
