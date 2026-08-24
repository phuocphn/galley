# One Desk serves every Review

`galley ./out` used to be a server: it bound a fixed port, held one folder, and blocked the terminal that started it. A second `galley ./other-folder` died on `EADDRINUSE`, so reviewing two folders together — a paper and its cover letter, two variants of the same copy — meant stopping one to look at the other.

Now one long-lived process, the Desk, holds every Review, each under its own path:

```
http://localhost:4317/r/launch-copy-a1b2
http://localhost:4317/r/whitepaper-9f3c
```

`galley <folder>` is no longer "start a server". It finds the Desk or starts one, asks it to open the folder, prints the URL and returns to the prompt. The Desk outlives the terminal, because the alternative is a Review whose life depends on a window the reviewer has no reason to think is special.

## Considered Options

- **A port derived from the folder** — hash the path into a range, so `./out` is always `localhost:4382`. Bookmarkable and needs no new process model; the change is confined to the CLI. Rejected because the derivation is only stable until it isn't: two folders can hash together, and anything else on the machine can be holding the port, so the fix is to probe upward — and now the URL depends on what was already running. A stable URL that is quietly sometimes not stable is worse than an obviously unstable one, because the reviewer only finds out when the bookmark opens the wrong folder.
- **An OS-assigned ephemeral port** — pass port 0, print what comes back. One line, never collides, and `startServer` already supported it for the tests. Rejected because every run gives a different URL: nothing to bookmark, nothing to recognise in a tab strip, and the terminal that printed it becomes load-bearing. It solves "two at once" and nothing else.
- **The first `galley` hosts, later ones register with it** — no detached process, no lifecycle to manage, and it looks like the current foreground command. Rejected on what Ctrl-C means: killing the first terminal silently takes down Reviews opened from other terminals. Making one arbitrary window special is exactly the property this decision is trying to remove.
- **Taking over the port when the host CLI dies** — the above, with the survivors electing a new host. Rejected as distributed-consensus complexity for a local editor: a handover races, drops in-flight requests, and rebuilds every watcher, all to avoid running a background process.

## Consequences

- **A Review is closed when nobody is looking at it**, thirty minutes after its last client disconnects; the Desk exits about two minutes after its last Review closes. The socket at `/r/<id>/api/events` is the signal, so no new bookkeeping was needed. Closing loses nothing — the Notes are in the sidecar and the located Anchors are a cache — which `tests/desk.test.ts` pins down.
- **`createReviewApp(reviewRoot)` is untouched.** It is still a single-Review app; the Desk mounts one per Review and strips the prefix before it sees a request. Every test that drove that seam still drives it, and `startServer` remains as its one-Review shape.
- **The client reads which Review it is from its own URL** (`src/client/base.ts`), so the page and its data cannot disagree about which folder is on screen.
- **Opening a folder is a request now**, not an argument at startup, which is a real exposure: anything that can reach the port can ask for any folder the reviewer can read, and DNS rebinding would otherwise put a web page inside the Desk's origin. `POST /api/reviews` is therefore guarded — loopback `Host`, no `Sec-Fetch-Site: cross-site`, and a JSON content type a form cannot send. Another *local process* asking for a folder is not an escalation; the browser is the threat.
- **The Desk can outlive the build that started it.** It reports its version at `GET /api/desk`, and a CLI from a different build replaces it rather than talking to code the reviewer has already changed. That, and not a state file, is also how the CLI knows whether a Desk is running at all: a process that answers cannot be wrong about existing.
- **Two `galley` commands at once can both try to start a Desk.** One wins the port; the loser must exit rather than half-serve, and the CLI that spawned it must keep polling until *a* Desk answers rather than assuming it was theirs.
- **There is no `--attach`.** A Desk tied to one terminal is the option this ADR rejected. `npm run dev:server` runs the Desk in the foreground for development, which is an entry point rather than a command.
