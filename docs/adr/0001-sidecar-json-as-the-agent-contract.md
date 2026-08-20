# A committed JSON sidecar is the whole interface to the agent

Notes need to reach a coding agent that already has filesystem access, so we write them to `.feedback/notes.json` at the root of the Review folder — one file per Review, keyed by relative Draft path — and document the format in a generated `.feedback/README.md`. The editor never launches an agent; it offers a "Copy handoff" button and watches the file for replies. `.feedback/` is committed, and Resolved Notes are kept.

## Considered Options

- **Per-Draft sidecars** (`draft.md.notes.json`) — Notes travel with the file, but the output folder fills with sidecars and "what's outstanding across the Review?" becomes a glob.
- **Markdown sidecars** — readable without tooling, but anchor context and reply threading become fragile hand-rolled parsing, and merge-by-id gets unpleasant.
- **Append-only JSONL** — concurrent writes can never clobber, but state must be replayed and compacted.
- **An MCP server the agent talks to** — tightest loop, but far more machinery and only works with MCP-capable clients.

## Consequences

- Both sides write the same file, so every write is read-modify-write **merged by Note id**. Neither side may rewrite it wholesale.
- The tool works with any agent that can read a file. Nothing is coupled to a particular CLI.
- The Note → Reply → Resolve trail is versioned alongside the prose, so the reasoning behind AI-generated content survives in git instead of evaporating in a chat window.
