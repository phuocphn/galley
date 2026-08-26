# The Draft pane is tabbed, and nothing is stacked above it

Notes on a whole Draft and Notes that have lost their Anchor were both rendered as
fixed strips above the Draft pane. Each capped its list at `max-h-64`, so on a real
Review — ADR-0007's example is 22 Orphaned Notes on one Draft — the two of them took
several hundred pixels from the thing the reviewer came to read. The Draft-view
group is now the app's one tab strip, `Source | Preview | Notes`, and nothing is
stacked above the pane at all.

The Notes tab has a definition that covers both: **every Note on this Draft with
nowhere in the text to draw itself.** A Draft-Scope Note never had an Anchor; an
Orphaned Note had one and lost it. Both are shown there, in their own sections.

## Considered Options

- **Leave the Orphaned strip where it is, and move only Draft-Scope Notes.** What was
  asked for, and the strip is genuinely zero-height when empty. Rejected because it
  leaves the larger of the two squeezes in place on exactly the Drafts where it hurts.
- **Move both lists to the sidebar, beside Review Notes.** Conceptually tidy — all
  three anchor-less things in one column — but a 288px column already holding the file
  tree and the Review Notes cannot also hold 22 orphans.
- **A second tab row above the existing Source/Preview group.** No restructuring of the
  view flag at all, but two stacked tab rows is the layout that prompted this.

## Consequences

- `OrphanedNotes` says an orphan "must never vanish", and this puts it behind a tab.
  What replaces the ambush is the tab's own badge, which carries the orphan count and
  turns amber when there is one. That is the reversal a future reader of that
  docstring should know about.
- Starting a re-attach switches to the Source tab, because the new text is picked in
  the editor.
- `preview/mode.ts` becomes a three-valued view rather than a boolean, and stays
  module-level and Review-wide for the reason it was written: "which view am I in"
  keeps one answer across Drafts. The Notes tab is always present, and a Draft with no
  whole-Draft Notes shows the empty state with **Add a Note** — which is now how the
  first one is written.
- The tab strip is always shown. Preview is simply absent from it for a Draft that has
  none, in place of today's rule where the whole group disappears for a `.txt` Draft.
- The Notes tab is rendered inside `DraftPane`, under the same hide-don't-unmount
  treatment the Preview already gets. Rendering it in `App.tsx` instead of
  `<DraftPane>` would unmount the CodeMirror view and discard every open thread and
  half-typed composer on each tab switch.
