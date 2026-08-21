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

import { CONTEXT_LENGTH } from '../../shared/anchor.js'

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

/**
 * A passage as the frame read it off the page: the words themselves, and the
 * rendered text either side of them.
 *
 * What a Preview that stamps no blocks has to send instead of an index. An HTML
 * Draft is sanitised and parsed before it is rendered and both throw positions
 * away, so there is no range to stamp and nothing to look up — the app has to
 * find these words in the Source (`docs/adr/0005`).
 *
 * The neighbouring text is here to tell repeats apart, and is worth less than
 * it looks: it is rendered text, so where the Source has a tag at the boundary
 * — which is most of the time — it agrees with nothing. When it cannot separate
 * two candidates the matcher declines, which is the intended outcome rather
 * than a shortfall.
 */
export interface RenderedPassage {
  text: string
  before: string
  after: string
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

/**
 * Where the reviewer had read to. Reported as they scroll rather than asked for
 * at the last moment, so the app always has the number when a document swap
 * takes it away — and when the reviewer switches to the Source, which is not a
 * moment that can wait for a round trip through this frame without the Source
 * visibly settling into place a beat after it appears.
 *
 * Two numbers for two different jobs. `top` is pixels, and is what puts the
 * frame back where it was after it has swapped documents. `block` is the
 * stamped block at the top of the viewport, and is what the Source is scrolled
 * to on the way out; it is null when nothing stamped is on screen, which for a
 * Markdown Draft means an empty one.
 */
export interface PreviewScrolled {
  kind: 'scrolled'
  top: number
  block: number | null
}

/**
 * Either gesture, made on a Preview that stamps no blocks.
 *
 * One message for both, because on an unstamped document they can only say the
 * same thing: a click reports the text of the block it landed in, a selection
 * the text that was selected, and neither has an index or a block to name. The
 * gesture is still carried, because the two mean what they always mean — a
 * click asks to be taken there, a selection asks for a Note.
 */
export interface PreviewText {
  kind: 'text'
  gesture: 'click' | 'select'
  passage: RenderedPassage
}

/** A gesture: the reviewer pointing at a passage, either way of pointing. */
export type PreviewGesture = PreviewClick | PreviewSelect | PreviewText

/**
 * Whether a gesture was the one that asks for a Note.
 *
 * Asked of the gesture rather than of the message kind, so that the answer does
 * not depend on whether the Draft's Preview happened to stamp its blocks.
 */
export function asksForANote(gesture: PreviewGesture): boolean {
  return gesture.kind === 'select' || (gesture.kind === 'text' && gesture.gesture === 'select')
}

/** Everything the Preview frame can say. */
export type PreviewMessage = PreviewGesture | PreviewScrolled

/** A selected phrase longer than this is not a phrase, and not worth matching. */
const LONGEST_PHRASE = 20_000

function asSelectedIn(value: unknown): SelectedIn | null {
  if (typeof value !== 'object' || value === null) return null
  const end = value as Record<string, unknown>
  if (!Number.isInteger(end.block) || (end.block as number) < 0) return null
  if (typeof end.text !== 'string' || end.text.length > LONGEST_PHRASE) return null
  return { block: end.block as number, text: end.text }
}

function asRenderedPassage(value: unknown): RenderedPassage | null {
  if (typeof value !== 'object' || value === null) return null
  const passage = value as Record<string, unknown>
  if (typeof passage.text !== 'string' || passage.text.length > LONGEST_PHRASE) return null
  // Context longer than the matcher reads is not context, so it is refused
  // rather than trimmed: the only sender is our own script, which sends exactly
  // this much, and anything else is not something to accommodate.
  if (typeof passage.before !== 'string' || passage.before.length > CONTEXT_LENGTH) return null
  if (typeof passage.after !== 'string' || passage.after.length > CONTEXT_LENGTH) return null
  return { text: passage.text, before: passage.before, after: passage.after }
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

  if (message.kind === 'text' && (message.gesture === 'click' || message.gesture === 'select')) {
    const passage = asRenderedPassage(message.passage)
    return passage ? { kind: 'text', gesture: message.gesture, passage } : null
  }

  if (message.kind === 'scrolled' && typeof message.top === 'number' && message.top >= 0) {
    const block =
      Number.isInteger(message.block) && (message.block as number) >= 0
        ? (message.block as number)
        : null
    return { kind: 'scrolled', top: message.top, block }
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
 * Put the frame back where the reviewer was reading, after it has swapped
 * documents. A number and nothing more.
 *
 * For a one-word edit the drift is invisible. For a full agent rewrite the
 * position is approximate, which is honest: that is a document worth noticing
 * has changed.
 */
export function restoreReadingMessage(top: number): unknown {
  return { galley: PREVIEW_MESSAGE, kind: 'reading', top }
}

/**
 * Bring a block to the top of the frame, because the Source view was being read
 * at that block when the reviewer switched here.
 *
 * A block index rather than a pixel offset: the two views agree about which
 * block a passage is, and about nothing else. Scrolling by percentage would
 * agree about neither — a Draft whose Source is half table syntax renders to a
 * document of quite different proportions — and would be wrong silently.
 */
export function showBlockMessage(block: number): unknown {
  return { galley: PREVIEW_MESSAGE, kind: 'block', block }
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
 *
 * Both gestures work on a document that stamps no blocks — an HTML Draft, whose
 * markup went through a sanitiser and a parser that keep no positions. There
 * the script reports the rendered text and its neighbours instead of an index,
 * and the app goes looking for it in the Source. Which of the two it does is
 * decided once, by whether the document it was handed carries any stamp at all,
 * so a click on the margin of a Markdown Preview stays the no-op it has always
 * been rather than becoming a document-wide search for nothing.
 *
 * It also keeps the app told which block is at the top of the frame as the
 * reviewer reads, and takes the reverse instruction — bring this block to the
 * top — for when they arrive here from the Source. Both are block indices; the
 * frame never computes an offset into the Source, which is the app's to work
 * out from the Draft's text. A document with no stamps has no block to report,
 * and says so, which is what leaves an HTML Draft's two views keeping their own
 * positions instead.
 */
export const PREVIEW_FRAME_SCRIPT = `
(function () {
  var BLOCK = '${PREVIEW_BLOCK_ATTRIBUTE}';
  var LIFT = 4;
  var CONTEXT = ${CONTEXT_LENGTH};

  // What counts as a passage on an unstamped page: the nearest ancestor that
  // reads as one block of prose. \`closest\` walks outwards, so the tightest of
  // these wins and the wrappers are only reached when nothing better is there.
  // \`body\` is deliberately absent — a click on the page margin is not a click
  // on a passage, and answering it with the whole document's text would trade a
  // no-op for a search that says the text could not be found.
  var PASSAGES = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, dt, dd, td, th,' +
    ' caption, figcaption, summary, div, section, article, aside, main, header, footer, nav';

  // Whether this document has stamped blocks to point at, which is the same
  // question as whether the Draft is Markdown — decided from the document
  // rather than told to us, because the document is the thing being read.
  var stamps = document.querySelector('[' + BLOCK + ']') !== null;

  var composerOpen = false;
  var addNote = null;

  function send(message) {
    message.galley = '${PREVIEW_MESSAGE}';
    parent.postMessage(message, '*');
  }

  function blockAt(target) {
    var node = target && target.nodeType === 1 ? target : target && target.parentElement;
    var stamped = node && node.closest ? node.closest('[' + BLOCK + ']') : null;
    if (!stamped) return null;
    var index = Number(stamped.getAttribute(BLOCK));
    return Number.isInteger(index) && index >= 0 ? { index: index, element: stamped } : null;
  }

  /**
   * The stamped block at the top of the viewport: the first one whose bottom
   * edge has not yet gone off the top of the screen.
   *
   * Strictly past the top edge, so a block scrolled to exactly the top of the
   * frame reports itself rather than the one that ends where it begins. That is
   * what makes switching to the Source and back land here again instead of one
   * block earlier every time.
   */
  function topmostBlock() {
    var stamped = document.querySelectorAll('[' + BLOCK + ']');
    for (var i = 0; i < stamped.length; i++) {
      if (stamped[i].getBoundingClientRect().bottom > 0) {
        var index = Number(stamped[i].getAttribute(BLOCK));
        return Number.isInteger(index) && index >= 0 ? index : null;
      }
    }
    return null;
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

  /** The range covering the passage a point on an unstamped page falls in. */
  function passageAt(target) {
    var node = target && target.nodeType === 1 ? target : target && target.parentElement;
    var element = node && node.closest ? node.closest(PASSAGES) : null;
    if (!element || element.textContent.trim() === '') return null;
    var range = document.createRange();
    range.selectNodeContents(element);
    return range;
  }

  /**
   * The rendered text either side of a range, as much of it as the matcher will
   * read.
   *
   * Walked over text nodes rather than taken from a Range's own toString,
   * because not every text node on this page was ever text to read: an HTML
   * Draft's <style> blocks are carried into the body so that they still apply,
   * this script is a text node at the end of it, and the **Add note** button is
   * one we put there ourselves. Handing any of them to the matcher as context
   * would be handing it noise.
   */
  function contextAround(range) {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement;
        if (!parent || parent.closest('style, script')) return NodeFilter.FILTER_REJECT;
        if (addNote && addNote.contains(parent)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    var before = '';
    var after = '';
    var node;
    while ((node = walker.nextNode()) && after.length < CONTEXT) {
      var text = node.data;
      // A node the range starts or ends inside contributes only its outer part.
      if (node === range.startContainer) before = (before + text.slice(0, range.startOffset)).slice(-CONTEXT);
      if (node === range.endContainer) after += text.slice(range.endOffset);
      else if (range.comparePoint(node, text.length) < 0) before = (before + text).slice(-CONTEXT);
      else if (range.comparePoint(node, 0) > 0) after += text;
    }

    return { before: before, after: after.slice(0, CONTEXT) };
  }

  /** A range as the words in it plus the words around them. */
  function passageOf(range) {
    var context = contextAround(range);
    return { text: range.toString(), before: context.before, after: context.after };
  }

  function selected() {
    if (composerOpen) return null;
    var selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

    var range = selection.getRangeAt(0);
    if (range.toString().trim() === '') return null;

    if (!stamps) return { range: range, first: null, last: null };

    var first = blockAt(range.startContainer);
    var last = blockAt(range.endContainer);
    if (!first || !last) return null;

    return { range: range, first: first, last: last };
  }

  /**
   * What to say about a selection. Built after the **Add note** button has been
   * taken back off the page, because the button is in the body and its own
   * label would otherwise be read as the text following the selection.
   */
  function selectionMessage(target) {
    if (!target.first || !target.last) {
      return { kind: 'text', gesture: 'select', passage: passageOf(target.range) };
    }
    return {
      kind: 'select',
      start: selectedIn(target.range, target.first),
      end: selectedIn(target.range, target.last)
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
      send(selectionMessage(target));
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

  function reportReading() {
    send({ kind: 'scrolled', top: window.scrollY, block: topmostBlock() });
  }

  var reporting = 0;
  window.addEventListener('scroll', function () {
    if (reporting) return;
    reporting = requestAnimationFrame(function () {
      reporting = 0;
      reportReading();
    });
  });

  /**
   * Bring a block to the top of the frame, and say where that left us.
   *
   * Measured in an animation frame rather than the instant the app asks. The
   * app asks as soon as this document has loaded, and a document that has
   * loaded has not necessarily been laid out yet: every rectangle in it is
   * still zero, so every block appears to begin at the top and scrolling to one
   * is scrolling to the top. It fails in silence, too, and permanently: nothing
   * moved, so no scroll event fires, so the app is never told the Preview is
   * not where it asked for it to be. An animation frame is the first moment the
   * document has a shape to measure.
   *
   * The reading position is reported whether or not the scroll moved anything,
   * for the same reason: being told to show the block already at the top is a
   * no-op, and a no-op that says nothing leaves the app believing the Preview
   * is somewhere it is not.
   */
  function bringToTop(index) {
    requestAnimationFrame(function () {
      var target = document.querySelector('[' + BLOCK + '="' + String(index) + '"]');
      if (target) window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY);
      reportReading();
    });
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

    if (stamps) {
      var block = blockAt(event.target);
      if (!block) return;
      send({ kind: 'click', block: block.index });
      return;
    }

    var range = passageAt(event.target);
    if (!range) return;
    send({ kind: 'text', gesture: 'click', passage: passageOf(range) });
  });

  window.addEventListener('message', function (event) {
    if (event.source !== parent) return;
    var data = event.data;
    if (!data || data.galley !== '${PREVIEW_MESSAGE}') return;

    if (data.kind === 'composer') {
      composerOpen = data.open === true;
      if (composerOpen) hideAddNote();
      else showAddNote();
      return;
    }

    if (data.kind === 'reading' && typeof data.top === 'number') {
      window.scrollTo(0, data.top);
      return;
    }

    // The block goes to the very top of the frame rather than near it. Anything
    // else would be a margin the app would then have to subtract back off when
    // it asked which block was topmost, and the two numbers would drift apart
    // one switch at a time.
    if (data.kind === 'block' && Number.isInteger(data.block)) {
      bringToTop(data.block);
    }
  });
})();
`
