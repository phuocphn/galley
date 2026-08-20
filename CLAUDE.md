# galley

A local editor for reviewing AI-generated prose and markup. Open a folder of generated files, select a range of text, attach guidance for the AI agent that will revise it. The guidance is written to a JSON sidecar beside the content so any coding agent can act on it.

Read `CONTEXT.md` for the domain language (Draft, Note, Anchor, Scope, Kind, Reply, Status, Review) and use those words in code, UI copy, and issues.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `phuocphn/galley`, via the `gh` CLI. External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage labels, unmapped — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
