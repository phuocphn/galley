import { describe, expect, it } from 'vitest'
import {
  PREVIEW_FRAME_SCRIPT,
  asPreviewMessage,
  asksForANote,
  type PreviewGesture,
} from '../src/client/preview/frame.js'

/**
 * What the reviewer meant by pointing at the Preview.
 *
 * A single click means nothing at all, a double-click means *take me there*,
 * and a drag means *I want to write a Note about this* — see `docs/adr/0011`.
 * Only the last of those opens a composer, and the difference between the first
 * two is the whole reason the Preview is readable.
 *
 * Where a passage lands in the Source is `preview-mapping.test.ts`; this is
 * only about which question is being asked.
 */

const GALLEY = 'galley-preview'

describe('which gesture asks for a Note', () => {
  it('a dragged selection does, in either format', () => {
    expect(
      asksForANote({
        kind: 'select',
        gesture: 'select',
        start: { block: 0, text: 'a' },
        end: { block: 0, text: 'a' },
      }),
    ).toBe(true)
    expect(
      asksForANote({
        kind: 'text',
        gesture: 'select',
        passage: { text: 'a', before: '', after: '' },
      }),
    ).toBe(true)
  })

  it('a double-click does not, even though it carries a precise range', () => {
    // This is the pairing the whole gesture rests on: the word a double-click
    // selected is exact enough to jump to, and asking for it is not asking to
    // write anything.
    const jump: PreviewGesture = {
      kind: 'select',
      gesture: 'click',
      start: { block: 2, text: '340%' },
      end: { block: 2, text: '340%' },
    }
    expect(asksForANote(jump)).toBe(false)
  })

  it('a passage sent by an HTML Preview’s double-click does not either', () => {
    expect(
      asksForANote({
        kind: 'text',
        gesture: 'click',
        passage: { text: 'Revenue grew 340%', before: '', after: '' },
      }),
    ).toBe(false)
  })

  it('a bare block does not', () => {
    expect(asksForANote({ kind: 'click', block: 4 })).toBe(false)
  })
})

describe('reading what the frame sent', () => {
  it('keeps the gesture on a precise range', () => {
    const message = asPreviewMessage({
      galley: GALLEY,
      kind: 'select',
      gesture: 'click',
      start: { block: 1, text: '340%' },
      end: { block: 1, text: '340%' },
    })

    expect(message).toEqual({
      kind: 'select',
      gesture: 'click',
      start: { block: 1, text: '340%' },
      end: { block: 1, text: '340%' },
    })
  })

  it('refuses a range that does not say what it is asking for', () => {
    // Untrusted input: the frame renders a Draft nobody has vouched for, and a
    // selection with no gesture would otherwise have to be guessed at — the one
    // guess that opens a composer over text the reviewer did not choose.
    expect(
      asPreviewMessage({
        galley: GALLEY,
        kind: 'select',
        start: { block: 1, text: 'x' },
        end: { block: 1, text: 'x' },
      }),
    ).toBeNull()

    expect(
      asPreviewMessage({
        galley: GALLEY,
        kind: 'select',
        gesture: 'shrug',
        start: { block: 1, text: 'x' },
        end: { block: 1, text: 'x' },
      }),
    ).toBeNull()
  })
})

describe('the script the frame runs', () => {
  it('answers a double-click, and no longer jumps on a single one', () => {
    expect(PREVIEW_FRAME_SCRIPT).toContain("addEventListener('dblclick'")

    // The single-click handler still exists — every click is swallowed, so a
    // link in a Draft stays a passage rather than a page — but it reports
    // nothing.
    const single = PREVIEW_FRAME_SCRIPT.slice(
      PREVIEW_FRAME_SCRIPT.indexOf("document.addEventListener('click'"),
      PREVIEW_FRAME_SCRIPT.indexOf("document.addEventListener('dblclick'"),
    )
    expect(single).toContain('preventDefault')
    expect(single).not.toContain('send(')
  })

  it('takes the Add note button down before answering a double-click', () => {
    // The browser selects a word on a double-click, which pops the button; it
    // must not be left standing over a gesture that is about to jump away from
    // it, and its own label must not be read as the passage's context.
    const dbl = PREVIEW_FRAME_SCRIPT.slice(
      PREVIEW_FRAME_SCRIPT.indexOf("document.addEventListener('dblclick'"),
    )
    expect(dbl.indexOf('hideAddNote()')).toBeLessThan(dbl.indexOf('send('))
  })

  it('sends a stamped page the word, and an unstamped page the passage', () => {
    const dbl = PREVIEW_FRAME_SCRIPT.slice(
      PREVIEW_FRAME_SCRIPT.indexOf("document.addEventListener('dblclick'"),
    )

    // Markdown stamps its blocks, so the selected word maps exactly.
    expect(dbl).toContain("selectionMessage(target, 'click')")
    // HTML stamps nothing and has to search the whole Source, where a single
    // word is the weakest possible key — so it sends the containing passage.
    expect(dbl).toContain('passageAt(event.target)')
    expect(dbl).toContain("gesture: 'click', passage: passageOf(range)")
  })
})
