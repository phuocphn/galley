# ai-feedback-editor

A local editor for writing feedback on AI-generated content.

Point it at a folder of `.md`, `.html`, and `.txt` files, and review them the way you'd review a pull request — line numbers, select a range, leave a note. Your notes are written to a JSON sidecar in the folder, so any coding agent can read them, revise the files, and reply.

```bash
npx ai-feedback-editor ./out
```

Status: in design. See [`CONTEXT.md`](./CONTEXT.md) for the domain language and [`docs/adr/`](./docs/adr) for the decisions behind it.
