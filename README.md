# ai-feedback-editor

A local editor for writing feedback on AI-generated content.

Point it at a folder of `.md`, `.html`, and `.txt` files, and review them the way you'd review a pull request — line numbers, select a range, leave a note. Your notes are written to a JSON sidecar in the folder, so any coding agent can read them, revise the files, and reply.

```bash
npx ai-feedback-editor ./out
```

Status: in design. See [`CONTEXT.md`](./CONTEXT.md) for the domain language and [`docs/adr/`](./docs/adr) for the decisions behind it.

## Development

```bash
npm install
npm test          # Vitest against the Review API, over temp fixture folders
npm run typecheck
npm run build     # client (Vite) + server (tsc) into dist/
node dist/cli.js ./some-folder
```

`npm run dev` serves the client with hot reload and proxies `/api` to a server
started separately with `npm run dev:server -- ./some-folder`.
