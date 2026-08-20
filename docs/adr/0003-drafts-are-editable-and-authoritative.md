# Drafts are directly editable, and the file on disk is authoritative

This is a review tool where you can edit the thing under review. Sometimes fixing the prose yourself is faster than explaining the fix, so the Draft pane is a real editor: edits autosave after a short idle, and a file watcher pulls in the agent's rewrites (silently when there are no pending edits, behind a keep-mine / take-theirs banner when there are). We deliberately do **not** track which ranges the reviewer touched. The handoff prompt instead tells the agent that the Draft may have been hand-edited and that current content is intentional.

## Considered Options

- **Read-only content plus GitHub-style suggestion blocks** — no edit/regeneration races, but you can never just fix the typo.
- **Protected regions** — persist every reviewer-edited range and ship it to the agent as do-not-modify. Strongest guarantee, but the range set needs its own persistence, re-anchoring after each pass, and a UI to clear it once stale.
- **Auto-create a Note on every edit** — nothing invisible to the agent, but fixing a typo becomes a three-step ceremony and the Note list fills with noise.

## Consequences

- The reviewer and the agent can both be mid-write on the same Draft. Autosave, watching, and conflict resolution are core, not polish.
- A hand edit subtle enough to be at risk of being reverted is exactly the case that deserves a Note. The tool does not try to protect it for you.
