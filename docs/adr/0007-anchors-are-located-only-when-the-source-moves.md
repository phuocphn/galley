# Anchors are located only when the Source moves

Where a Note points is a pure question about two pieces of text: the Draft as it
stands, and the Anchor's own stored text. Nothing else can move a Note — not its
Status, not a Reply, not another Note. So an Anchor can only move when the Source
moves, and locating one against an unchanged Draft is definitionally wasted work.

We now rely on that. Locating is memoised per Draft, one generation per version
of the Draft's text, keyed within that generation by the Anchor's own text rather
than by the Note's identity. And `PUT /api/draft` no longer locates Anchors at
all: it writes the file and returns what it wrote. Reading is where the question
gets asked, because reading is where someone is waiting for the answer.

## Why it was worth deciding

On a real Review — a LaTeX paper, 48 Notes on one 28 KB Draft, 22 of them
Orphaned — locating took **19.1 seconds**, synchronously, which on a single
threaded server means nothing else was answered for 19 seconds. It ran on every
read, on every autosave, and twice per click: once for the caller's own refresh,
and again when the file watcher saw the server's own write to the sidecar.

The cost is carried almost entirely by Orphaned Notes. A Note whose text is still
there is found by `indexOf` for nothing; a Note whose passage the agent rewrote
away falls through to fuzzy matching, which is quadratic. The Notes that cost the
most are exactly the ones a re-search will fail to find again, every time.

## Considered Options

- **Make the matcher cheap and keep locating on every request.** Necessary, and
  done separately — but it does not help the write path, where the content
  genuinely changed and every memo entry misses. At any plausible speed, putting
  a full re-anchoring pass between each pause in the reviewer's typing and their
  next keystroke is the wrong shape.
- **Cache the whole located array per Draft.** Simpler to hold, but Statuses and
  Replies would ride along inside the cached value and have to be merged back out
  on the way past. The memo would then hold things it has no business holding.

## Consequences

- `PUT /api/draft` returns `DraftWritten` — path, extension, content — and says
  nothing about the Notes. This reads like an oversight and is not one. Putting
  the Notes back would return a 19-second pass to every keystroke pause.
- Misses are memoised as carefully as hits. A memo that kept only hits would skip
  precisely the Orphaned Anchors that are expensive to look for.
- The memo is keyed by the Anchor's text, not by the Note's id, because
  `changeNote` stamps `updatedAt` on every mutation including Resolve. Keying on
  the Note's version would discard the costliest entry at the exact moment the
  reviewer resolves an Orphaned Note.
- A Note is Orphaned only as far as the current text is concerned. An agent that
  restores a deleted passage changes the Draft, which rolls the generation, and
  the Note is found again on the next read. Nothing has to remember it was lost.
