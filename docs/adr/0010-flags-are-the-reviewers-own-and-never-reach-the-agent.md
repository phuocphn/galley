# Flags are the reviewer's own, and live outside the agent contract

A reviewer reading a Draft often notices something without yet knowing what to say
about it. That is a Flag: a passage marked to come back to, addressed to nobody.
It is not a Note, because a Note is by definition guidance for the agent (ADR-0001
makes `.feedback/notes.json` the contract, and `handoffInstruction` tells the agent
to work every Note whose Status is not Resolved). So Flags live in their own file,
`.feedback/flags.json`, and the agent is never pointed at it.

A Flag carries a `draftPath`, an Anchor, an optional `reason`, and nothing else. No
Kind, no Status, no Replies — every one of those exists to coordinate with an agent
that is not part of this conversation. It always has an Anchor, so unlike a Note it
has no Scope to derive: there is nothing for a `flagScopeOf` to answer.

## Considered Options

- **An `audience: 'reviewer'` field on Note.** One entity, one file, one UI, and
  promotion becomes a field edit. Rejected because the handoff hands the agent that
  exact file and invites it to read the Notes directly; "the agent must filter these
  out" is a rule an agent can fail to follow, where "the agent is never told the file
  exists" is not.
- **A fourth Kind, `flag`.** The smallest diff. Rejected because it contradicts what
  Kind means — "what a Note asks the agent to do" — and this one asks the agent
  nothing. It would be the only Kind that changes the addressee rather than the ask.
- **A `flags` array alongside `notes` in the same file.** One read, one write, one
  watcher event. Rejected because `handoffInstruction` already warns the agent never
  to rewrite `notes.json` wholesale — a warning that exists because agents do — and
  the Flags would be the silent casualty.
- **Browser storage only.** No contract risk at all. Rejected because a Flag's whole
  value is surviving until the agent has rewritten the Draft around it, and a
  browser-only Flag has no way to ask where its passage went.

## Consequences

- `.feedback/README.md` now carves out an exception to itself: the folder is for the
  agent, except `flags.json`, which the agent must not read or act on.
- Clearing a Flag deletes it. There is no Resolved state and no "show cleared"
  toggle: a Flag has no Replies and no audit trail, so there is nothing about a
  finished one worth keeping, and the list is always exactly the outstanding work.
- Promoting a Flag to a Note writes `notes.json` first and `flags.json` second.
  There is no transaction across two files, and a crash between them should leave a
  stray Flag rather than a lost Note.
- A Flag whose passage is gone is kept and shown as Orphaned, not dropped. ADR-0007
  holds for Flags exactly as it does for Notes: an agent that restores the passage
  makes the Flag findable again on the next read, and nothing has to remember it was
  lost. It gets no re-attach flow, though — that exists to save an instruction the
  agent still owes you, and a Flag owes nobody anything.
- Flags are located only for the Draft that is open. `listDrafts` reads no Draft
  contents, and the Review listing is refetched on every Note mutation and every
  watcher event; locating every Flag in every Draft on each of those is the cost
  shape ADR-0007 was written to remove. The open Draft's Flags ride along in
  `DraftContents`, where the file is already read and the memo already warm. Every
  other Draft's Flags appear in the sidebar from their stored Anchor text, with no
  orphan state until you open that Draft.
