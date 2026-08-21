/**
 * The one script that runs inside the Preview frame, and the messages it sends.
 *
 * The frame is served with `sandbox="allow-scripts"` and a Content-Security-
 * Policy whose `script-src` names a nonce minted for that document, so this is
 * the only script that runs in it — see `docs/adr/0004`. `allow-same-origin` is
 * withheld, so the frame sits in an opaque origin: it cannot reach the app's
 * DOM, its storage, or the local API that writes to disk, and `postMessage` is
 * the only way it can say anything at all.
 *
 * The script is a string rather than a module because it is not part of the
 * app's bundle: it is handed to the frame inside the document, and runs in a
 * context that shares nothing with this one.
 */

/** Where a rendered block's `[from, to)` in the Source is stamped. */
export const PREVIEW_BLOCK_ATTRIBUTE = 'data-galley-block'

/**
 * Marks a message as coming from our script rather than from anything else that
 * might post to this window. It is not a secret and proves nothing on its own —
 * the sender's window identity is what does that.
 */
const PREVIEW_MESSAGE = 'galley-preview'

/** The reviewer pointed at a passage: take me to this in the Source. */
export interface PreviewClick {
  kind: 'click'
  /** The stamped block the click landed in. */
  block: number
}

/** Which block a selection ran into, and the text of it that was selected. */
export interface SelectedIn {
  block: number
  text: string
}

/**
 * The reviewer selected a phrase and pressed **Add note**: I want to write a
 * Note about this.
 *
 * A selection may run across blocks, so both ends are reported. When it stays
 * inside one, both ends name the same block and the same text.
 */
export interface PreviewSelect {
  kind: 'select'
  start: SelectedIn
  end: SelectedIn
}

/** Everything the Preview frame can say. */
export type PreviewMessage = PreviewClick | PreviewSelect

/** A selected phrase longer than this is not a phrase, and not worth matching. */
const LONGEST_PHRASE = 20_000

function asSelectedIn(value: unknown): SelectedIn | null {
  if (typeof value !== 'object' || value === null) return null
  const end = value as Record<string, unknown>
  if (!Number.isInteger(end.block) || (end.block as number) < 0) return null
  if (typeof end.text !== 'string' || end.text.length > LONGEST_PHRASE) return null
  return { block: end.block as number, text: end.text }
}

/**
 * Read a `message` event's data as something our frame sent, or null.
 *
 * Whatever arrives here is untrusted input: the frame renders a Draft nobody
 * has vouched for yet, so every field is checked rather than assumed.
 */
export function asPreviewMessage(data: unknown): PreviewMessage | null {
  if (typeof data !== 'object' || data === null) return null
  const message = data as Record<string, unknown>
  if (message.galley !== PREVIEW_MESSAGE) return null

  if (message.kind === 'click' && Number.isInteger(message.block) && (message.block as number) >= 0) {
    return { kind: 'click', block: message.block as number }
  }

  if (message.kind === 'select') {
    const start = asSelectedIn(message.start)
    const end = asSelectedIn(message.end)
    return start && end ? { kind: 'select', start, end } : null
  }

  return null
}

/**
 * What the app tells the frame: whether a composer is already open in the
 * Source view behind it.
 *
 * The frame cannot see the Source view, and the **Add note** button has to
 * stand down while a composer is open for the same reason the Source view's own
 * does — it would replace a Note being written mid-sentence. Nothing secret
 * travels this way, which is why `'*'` is an acceptable target origin for a
 * frame that has no origin of its own to name.
 */
export function composerStateMessage(open: boolean): unknown {
  return { galley: PREVIEW_MESSAGE, kind: 'composer', open }
}

/**
 * The listener injected into the Preview frame.
 *
 * It reports what the reviewer pointed at and nothing else: never a DOM node,
 * and never an offset, which is the app's to work out from the Source. Written
 * as plain ES5-ish script because it is never compiled — it is a string in the
 * document the frame is handed.
 *
 * Two gestures, deliberately meaning different things. A click is *take me to
 * this in the Source*, and every click is swallowed: a link in a Draft is a
 * passage like any other, not a page to navigate to. A selection is *I want to
 * write a Note about this*, and offers the same floating **Add note** button
 * the Source view does, under the same rules — nothing on a collapsed or
 * whitespace-only selection, and nothing while a composer is already open.
 *
 * A drag that selects text ends in a click event too, so a click only counts as
 * a click when it left nothing selected.
 */
export const PREVIEW_FRAME_SCRIPT = `
(function () {
  var BLOCK = '${PREVIEW_BLOCK_ATTRIBUTE}';
  var LIFT = 4;

  var composerOpen = false;
  var addNote = null;

  function blockAt(target) {
    var node = target && target.nodeType === 1 ? target : target && target.parentElement;
    var stamped = node && node.closest ? node.closest('[' + BLOCK + ']') : null;
    if (!stamped) return null;
    var index = Number(stamped.getAttribute(BLOCK));
    return Number.isInteger(index) && index >= 0 ? { index: index, element: stamped } : null;
  }

  /** The part of a selection that falls inside one block. */
  function selectedIn(range, block) {
    var clipped = range.cloneRange();
    var whole = document.createRange();
    whole.selectNodeContents(block.element);
    if (clipped.compareBoundaryPoints(Range.START_TO_START, whole) < 0) {
      clipped.setStart(whole.startContainer, whole.startOffset);
    }
    if (clipped.compareBoundaryPoints(Range.END_TO_END, whole) > 0) {
      clipped.setEnd(whole.endContainer, whole.endOffset);
    }
    return { block: block.index, text: clipped.toString() };
  }

  function selected() {
    if (composerOpen) return null;
    var selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

    var range = selection.getRangeAt(0);
    if (range.toString().trim() === '') return null;

    var first = blockAt(range.startContainer);
    var last = blockAt(range.endContainer);
    if (!first || !last) return null;

    return {
      range: range,
      start: selectedIn(range, first),
      end: selectedIn(range, last)
    };
  }

  function hideAddNote() {
    if (!addNote) return;
    addNote.remove();
    addNote = null;
  }

  function makeAddNote() {
    var node = document.createElement('button');
    node.type = 'button';
    node.textContent = 'Add note';
    node.title = 'Leave a Note on the selected text';
    node.setAttribute('style', [
      'position:absolute',
      'z-index:2147483647',
      'display:block',
      'padding:3px 8px',
      'border:none',
      'border-radius:6px',
      'background:#0969da',
      'color:#fff',
      'box-shadow:0 1px 3px rgba(31, 35, 40, 0.24)',
      'font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
      'font-size:12px',
      'font-weight:500',
      'line-height:1.4',
      'white-space:nowrap',
      'cursor:pointer'
    ].join(';'));

    // Pressing a control outside the text would move focus and drop the
    // selection before the click landed, which is what the Anchor is about to
    // be cut from.
    node.addEventListener('mousedown', function (event) { event.preventDefault(); });
    node.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      var target = selected();
      if (!target) return;
      hideAddNote();
      parent.postMessage(
        { galley: '${PREVIEW_MESSAGE}', kind: 'select', start: target.start, end: target.end },
        '*'
      );
    });
    return node;
  }

  function showAddNote() {
    var target = selected();
    if (!target) { hideAddNote(); return; }

    if (!addNote) {
      addNote = makeAddNote();
      document.body.appendChild(addNote);
    }

    var box = target.range.getBoundingClientRect();
    var top = box.top + window.scrollY - addNote.offsetHeight - LIFT;
    // Above the selection, so the button never covers the words being judged —
    // unless there is no room, in which case it goes below them.
    if (top < window.scrollY) top = box.bottom + window.scrollY + LIFT;
    addNote.style.left = (box.left + window.scrollX) + 'px';
    addNote.style.top = top + 'px';
  }

  document.addEventListener('selectionchange', showAddNote);

  document.addEventListener('click', function (event) {
    event.preventDefault();
    if (addNote && addNote.contains(event.target)) return;

    // A drag that selected a phrase ends in a click event as well. That gesture
    // is a selection, and answering it as a click would jump away from the
    // words the reviewer had just chosen.
    var selection = document.getSelection();
    if (selection && !selection.isCollapsed) return;

    var block = blockAt(event.target);
    if (!block) return;
    parent.postMessage({ galley: '${PREVIEW_MESSAGE}', kind: 'click', block: block.index }, '*');
  });

  window.addEventListener('message', function (event) {
    if (event.source !== parent) return;
    var data = event.data;
    if (!data || data.galley !== '${PREVIEW_MESSAGE}' || data.kind !== 'composer') return;
    composerOpen = data.open === true;
    if (composerOpen) hideAddNote();
    else showAddNote();
  });
})();
`
