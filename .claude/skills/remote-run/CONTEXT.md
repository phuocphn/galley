# remote-run — Domain Glossary

A skill for offloading heavy commands from the local machine to the beefy TUM
box, against a synced mirror of the local CircuitGenome tree. This glossary pins
the vocabulary; it holds no implementation detail.

**Target**:
The fixed local↔remote binding this skill operates on: the local CircuitGenome
working tree and its remote checkout `pham@10.157.146.6:/home/pham/code/analog-ml/CircuitGenome`.
The command is general, but the Target is not — machine and project are baked in.
_Avoid_: host, server, machine (when you mean the whole binding), destination.

**Sync**:
The one-directional mirror of the local working tree onto the remote checkout via
`rsync --delete`, protecting the remote's own `.git`/`.venv` and stripping caches.
Always local → remote; never the reverse.
_Avoid_: copy, upload, push, deploy, transfer.

**Run session**:
The named tmux session on the remote that holds one detached command and keeps it
alive across SSH drops. Default name `cg-remote`; one live Run session per name.
_Avoid_: job, process, task, tmux (bare), window.

**Run log**:
The file capturing a Run session's combined output, written **outside** the
checkout at `~/.remote-run/<session>.log` so Sync's `--delete` can't wipe it. Ends
with an `EXIT=<code>` marker when the command finishes.
_Avoid_: output, log file (unqualified), transcript, stdout.

**Verdict**:
The result the skill reports back: the command's process **exit code** (`0` =
success) plus the tail of the Run log. The universal, command-agnostic success
signal — not a parsed pytest summary.
_Avoid_: result, status (when you mean pass/fail), report, outcome.

**Preflight**:
The silent non-interactive `ssh` check run before work: reachable via key auth,
`tmux`/`uv`/`rsync` present, checkout exists. A `Permission denied` here means key
auth isn't set up (fix: one-time `ssh-copy-id`).
_Avoid_: healthcheck, ping, setup, connect.
