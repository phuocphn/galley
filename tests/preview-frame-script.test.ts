import { JSDOM } from 'jsdom'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  PREVIEW_BLOCK_ATTRIBUTE,
  PREVIEW_FRAME_SCRIPT,
  asPreviewMessage,
  type PreviewMessage,
} from '../src/client/preview/frame.js'

/**
 * The script the Preview frame actually runs, executed.
 *
 * It is a string that is never compiled — it lives inside the sandboxed
 * document the frame is handed (`docs/adr/0004`) — so nothing else in the build
 * type-checks it and no browser test can reach it: the frame has no origin of
 * its own, and driving a selection inside it from outside is not possible.
 * Running it against a DOM here is the only way to find out whether a
 * double-click says what it is supposed to say.
 *
 * What is asserted is the *message*, never how it was arrived at. Where that
 * message then lands in the Source is `preview-mapping.test.ts`.
 */

const STAMPED = `
  <p ${PREVIEW_BLOCK_ATTRIBUTE}="0">Introducing Meridian</p>
  <p ${PREVIEW_BLOCK_ATTRIBUTE}="1">Revenue grew 340% year on year.</p>
`

/** An HTML Draft's Preview: rendered, sanitised, and carrying no positions. */
const UNSTAMPED = `
  <p>Introducing Meridian</p>
  <p>Revenue grew 340% year on year.</p>
`

interface Frame {
  document: Document
  /** Everything the script has posted to the app, oldest first. */
  sent: PreviewMessage[]
  /** Select a word inside a paragraph, as a double-click does. */
  selectWord(paragraph: number, word: string): void
  clearSelection(): void
  /** Dispatch a real event at a node, the way the browser would. */
  fire(node: Node, type: 'click' | 'dblclick'): void
  paragraph(index: number): Element
  /** Let `selectionchange` land — the DOM announces it on a later tick. */
  settle(): Promise<void>
}

function runScript(body: string): Frame {
  const dom = new JSDOM(`<body>${body}</body>`, { runScripts: 'outside-only' })
  const { window } = dom
  const sent: PreviewMessage[] = []

  // The script talks to the app by posting to `parent`. Nothing else about the
  // app is stubbed: what is under test is what it chooses to say.
  Object.defineProperty(window, 'parent', {
    value: {
      postMessage: (data: unknown) => {
        const message = asPreviewMessage(data)
        // Read back through the app's own parser, so a message this script can
        // send but the app would reject fails here rather than in the running
        // editor.
        if (message) sent.push(message)
        else throw new Error(`the app would reject this message: ${JSON.stringify(data)}`)
      },
    },
  })
  // jsdom has no layout, and the **Add note** button asks a Range where it is
  // so it can float above it. Where the button lands is not what is under test
  // here — what it says when pressed is.
  window.Range.prototype.getBoundingClientRect = () =>
    ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect

  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0)
    return 0
  }) as typeof window.requestAnimationFrame

  window.eval(PREVIEW_FRAME_SCRIPT)

  const paragraph = (index: number): Element =>
    window.document.querySelectorAll('p')[index] as Element

  return {
    document: window.document,
    sent,
    paragraph,
    selectWord(index, word) {
      const node = paragraph(index).firstChild!
      const at = node.textContent!.indexOf(word)
      if (at < 0) throw new Error(`"${word}" is not in that paragraph`)

      const range = window.document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + word.length)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
    },
    clearSelection() {
      window.getSelection()!.removeAllRanges()
    },
    fire(node, type) {
      node.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true }))
    },
    settle: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  }
}

let frame: Frame

describe('a single click in the Preview', () => {
  beforeEach(() => {
    frame = runScript(STAMPED)
  })

  it('says nothing at all, so the reviewer stays where they were reading', () => {
    frame.fire(frame.paragraph(1).firstChild!, 'click')
    expect(frame.sent).toEqual([])
  })

  it('is still swallowed, so a link in a Draft is not a page to navigate to', () => {
    const event = new (frame.document.defaultView as Window & typeof globalThis).MouseEvent(
      'click',
      { bubbles: true, cancelable: true },
    )
    frame.paragraph(1).dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('a double-click in a Markdown Preview', () => {
  beforeEach(() => {
    frame = runScript(STAMPED)
  })

  it('asks to be taken to the word it selected, and not for a Note', () => {
    // What the browser itself does on a double-click, before the handler runs.
    frame.selectWord(1, '340%')
    frame.fire(frame.paragraph(1).firstChild!, 'dblclick')

    expect(frame.sent).toEqual([
      {
        kind: 'select',
        gesture: 'click',
        start: { block: 1, text: '340%' },
        end: { block: 1, text: '340%' },
      },
    ])
  })

  it('falls back to the block when there is no word under the pointer', () => {
    // A double-click on a gap selects nothing. The block is still somewhere to
    // be taken, which beats doing nothing at all.
    frame.clearSelection()
    frame.fire(frame.paragraph(0), 'dblclick')

    expect(frame.sent).toEqual([{ kind: 'click', block: 0 }])
  })
})

describe('a double-click in an HTML Preview', () => {
  beforeEach(() => {
    frame = runScript(UNSTAMPED)
  })

  it('sends the containing passage, not the word', () => {
    // An unstamped page has no offsets, so the app must find this text in the
    // Source. A single word is the weakest possible key across a whole
    // document — see `docs/adr/0005` and `docs/adr/0011`.
    frame.selectWord(1, '340%')
    frame.fire(frame.paragraph(1).firstChild!, 'dblclick')

    expect(frame.sent).toHaveLength(1)
    const message = frame.sent[0]!
    expect(message.kind).toBe('text')
    if (message.kind !== 'text') throw new Error('unreachable')
    expect(message.gesture).toBe('click')
    expect(message.passage.text).toBe('Revenue grew 340% year on year.')
  })
})

describe('a dragged selection, in either format', () => {
  it('still asks for a Note, and is not confused with a jump', async () => {
    frame = runScript(STAMPED)
    frame.selectWord(1, 'Revenue grew 340%')
    await frame.settle()

    // The **Add note** button is what a drag offers, and pressing it is what
    // asks for the composer. Nothing is sent by the selection on its own.
    expect(frame.sent).toEqual([])

    const button = frame.document.querySelector('button')
    expect(button, 'a selection should offer the Add note button').not.toBeNull()

    frame.fire(button!, 'click')
    expect(frame.sent).toEqual([
      {
        kind: 'select',
        gesture: 'select',
        start: { block: 1, text: 'Revenue grew 340%' },
        end: { block: 1, text: 'Revenue grew 340%' },
      },
    ])
  })
})
