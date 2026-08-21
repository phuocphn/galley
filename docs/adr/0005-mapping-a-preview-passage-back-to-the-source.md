# A Preview passage is mapped back to the Source exactly for Markdown, by search for HTML

Notes anchor to Source text (ADR 0002), so a Note begun in the Preview has to name a Source range. Markdown gives us one exactly: `marked`'s top-level tokens each carry their `raw`, so accumulating them stamps every rendered block with its `[from, to)` in the Source. HTML gives us nothing — `DOMPurify.sanitize` then `DOMParser` discard positions — so an HTML Preview maps by finding the rendered text in the Source with the Note matcher (`locateAnchor`). A selected phrase is searched inside its own block's Source slice for Markdown, and across the whole document for HTML.

For any of those offsets to mean anything, the Preview renders a **snapshot of the editor buffer**, taken when the reviewer switches to it and after a flush — not the server's copy of the Draft. The Source view is hidden while the Preview is up, so the buffer cannot move underneath it: the snapshot and the buffer are one coordinate space by construction, including while a conflict is unanswered and the buffer is the only place the reviewer's version exists.

## Considered Options

- **`parse5` with `sourceCodeLocationInfo` over the unsanitised HTML** — exact for both formats. Rejected: a new dependency, and DOMPurify's output stops being 1:1 with the parsed source the moment it drops an element.
- **Pairing Source block tags to rendered blocks by document order** — cheap, and correct until sanitising removes one element, after which every later pairing is off by one and the reviewer lands on the wrong paragraph with nothing to indicate it.
- **Searching for everything, both formats** — one code path, but it throws away offsets `marked` is already handing us and turns a click on a short heading into a document-wide guess.
- **Rendering the server's `draft.content`, or live-following the buffer keystroke by keystroke** — the first leaves a staleness window where offsets are cut from text that is no longer on screen, and shows the agent's document during a conflict; the second re-renders for typing that cannot happen, because the Source view is hidden.

## Consequences

- When a search is ambiguous or fails we degrade rather than guess, in the spirit of ADR 0002. Markdown falls back to the containing block, which is always exact. HTML stays in the Preview and says the text could not be found — leaving the reviewer's place intact, since losing it is the grievance this feature exists to fix.
- Rendered text is not Source text: `**billed monthly**` renders as `billed monthly`, so any phrase spanning inline markup takes the matcher's fuzzy path. Scoped to one Markdown block that is safe; across an HTML document it is the weakest point in the design.
- The same stamped offsets keep both views on the same passage when switching between them. HTML has no offsets, so its Source and Preview each keep their own scroll position instead.
