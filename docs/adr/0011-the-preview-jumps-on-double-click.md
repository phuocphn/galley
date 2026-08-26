# The Preview jumps to the Source on a double-click, not a single one

A single click in the Preview used to switch to the Source and select the clicked
block. That makes the Preview unreadable: every click meant to place the cursor,
dismiss a selection, or simply rest the mouse threw the reviewer out of the view
they were reading in. A single click is now inert, and a **double-click** is what
asks to be taken to the Source. Clicks are still swallowed either way — a link in a
Draft is a passage, not a page to navigate to (ADR-0004).

A double-click carries something a single click did not: the browser has already
selected the word under the cursor. Where that word can be mapped exactly, it is
kept and becomes the jump target, so the reviewer lands on the word rather than on
its paragraph.

## Considered Options

- **Collapse the word selection and jump to the block, as before.** The smallest
  change, and it needs no new message shape. Rejected because the selection is
  precision the gesture is handing us for free in the format where it costs nothing.
- **Send the word for both formats.** One rule, no asymmetry to explain. Rejected on
  ADR-0005's own reasoning: an HTML Draft has no positions and must find the rendered
  text in the Source with the fuzzy matcher across the whole document, which that ADR
  already calls the weakest point in the design. A single common word is the worst
  possible search key, and ADR-0005's degrade path is to stay put and say the text
  could not be found — so double-clicking "data" in an HTML Draft would usually do
  nothing at all, which reads as the feature being broken.
- **A preference — jump on single or double click.** Nobody is wrong, but every
  preview gesture then has two code paths to reason about and test, forever.

## Consequences

- Markdown sends `{ kind: 'select', gesture: 'click' }` with block-relative offsets:
  exact, no search. HTML sends `{ kind: 'text', gesture: 'click' }` with the
  containing passage — the same strong search key today's click already gives it.
  This is ADR-0005's existing format asymmetry applied to a new gesture, not a new
  one.
- `PreviewSelect` gains a `gesture` field. `asksForANote()` asks the gesture, not the
  message kind, so a precise range that only wants a jump is now expressible: the
  reviewer lands selected, with the floating **Add note** button, and no composer.
- The frame suppresses its own **Add note** button for a selection made by
  double-click. Without that, the browser's word selection fires `selectionchange`,
  the button appears, and the view then jumps away from it.
- `PREVIEW_HINT` and the comment at `preview/mapping.ts` both promised a single
  click and are updated. A reader finding the old wording would otherwise conclude
  the double-click was a bug.
