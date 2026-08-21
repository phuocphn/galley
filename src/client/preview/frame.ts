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

/** Everything the Preview frame can say. */
export type PreviewMessage = PreviewClick

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
  return null
}

/**
 * The listener injected into the Preview frame.
 *
 * It reports what the reviewer pointed at and nothing else: never a DOM node,
 * and never an offset, which is the app's to work out from the Source. Written
 * as plain ES5-ish script because it is never compiled — it is a string in the
 * document the frame is handed.
 *
 * Every click is swallowed. A link in a Draft is a passage like any other, so
 * pointing at it means *take me to this in the Source*, never *navigate the
 * Preview away to a remote page*.
 */
export const PREVIEW_FRAME_SCRIPT = `
(function () {
  var BLOCK = '${PREVIEW_BLOCK_ATTRIBUTE}';

  function blockAt(target) {
    var node = target && target.nodeType === 1 ? target : target && target.parentElement;
    var stamped = node && node.closest ? node.closest('[' + BLOCK + ']') : null;
    if (!stamped) return null;
    var index = Number(stamped.getAttribute(BLOCK));
    return Number.isInteger(index) && index >= 0 ? index : null;
  }

  document.addEventListener('click', function (event) {
    event.preventDefault();
    var block = blockAt(event.target);
    if (block === null) return;
    parent.postMessage({ galley: '${PREVIEW_MESSAGE}', kind: 'click', block: block }, '*');
  });
})();
`
