# Notes anchor to text, not line numbers

The whole point of the tool is that an agent rewrites the Draft between passes, which makes line numbers worthless the moment they matter most. An Anchor therefore stores the anchored text plus a few lines of surrounding context, with line numbers kept only as a hint. Within a session CodeMirror 6 maps every Anchor through the reviewer's keystrokes automatically; on reload, Anchors are re-found by matching their stored text. A Note whose text can no longer be found becomes Orphaned and is pinned at the top of the Draft for re-attachment — never silently dropped, and never silently pointed at the wrong line.

## Considered Options

- **Line numbers only** (`{file, startLine, endLine}`) — honest and trivial, but every Note is meaningless after one agent pass.
- **Structural anchors** (heading path + paragraph index, DOM path) — very robust to rewording and reads well to an agent, but it's a parser per format and `.txt` has no structure to anchor to.

## Consequences

- Re-anchoring is fuzzy matching, with real edge cases: ambiguous matches, near-misses, and text that moved rather than changed. It is one of only two areas we unit-test.
- Orphaned is a first-class Status, not an error condition. An orphan usually means the agent *did* the work.
