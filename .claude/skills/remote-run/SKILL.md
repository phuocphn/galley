---
name: remote-run
description: Run any command (e.g. the CircuitGenome test suite) on the beefy TUM box against a synced mirror of the local working tree, kept alive in tmux, then report the exit code and tail. Explicit-invoke only.
disable-model-invocation: true
---

# remote-run

Offload a heavy command to the remote TUM machine because the local machine
isn't powerful enough (SPICE/ngspice runs, the full pytest suite, long jobs).
The command is arbitrary; the **machine and project are fixed**:

| | |
|---|---|
| local  | `/Users/phuocpham/workspace/projects/CircuitGenome` |
| remote | `pham@10.157.146.6:/home/pham/code/analog-ml/CircuitGenome` |
| ssh    | key auth, `-o ServerAliveInterval=240` |

All orchestration lives in [`scripts/remote-run.sh`](scripts/remote-run.sh) —
prefer it over hand-writing `ssh`/`rsync`/`tmux` commands.

## The flow

Each run is: **sync → launch detached in tmux → poll until done → report.**
The remote run survives SSH drops because it lives in a tmux session; the log is
written **outside** the checkout (`~/.remote-run/<session>.log`) so `rsync --delete`
never wipes it mid-run.

Let `RR=".claude/skills/remote-run/scripts/remote-run.sh"` (path relative to the
skills repo; adjust to wherever you invoke from).

### 1. Preflight (first run of a session, or on any failure)

```bash
bash "$RR" preflight
```

Confirms the box is reachable **non-interactively**, that `tmux`/`uv`/`rsync`
exist, and the checkout is present. If it prints `Permission denied`, key auth
isn't set up — tell the user to run **once**:

```
ssh-copy-id -o ServerAliveInterval=240 pham@10.157.146.6
```

Do not proceed until preflight is clean.

### 2. Launch

Pick the command based on the task. Everything after `--` is run verbatim on the
remote, inside the checkout:

```bash
bash "$RR" run -- uv run pytest                    # whole suite (default heavy job)
bash "$RR" run -- uv run pytest tests/test_spice_sim.py -x   # chase one failure
bash "$RR" run -- uv run python examples/foo.py    # any non-test job
```

- `run` rsyncs the local tree first (`--delete`, excluding `.git/ .venv/
  __pycache__/ .pytest_cache/`), then starts the command detached and returns
  immediately.
- Default tmux session is **`cg-remote`**. If it's already busy, `run` refuses to
  clobber it and prints that run's status — wait, `tail`, or `kill` it. To run a
  second thing concurrently, pass `--session cg-remote-<label>`.

### 3. Poll until done

```bash
bash "$RR" poll        # -> "running" | "done EXIT=N" | "idle"
```

Loop with a short sleep between polls (e.g. 15–30s for a full suite). Keep going
until it prints `done EXIT=N`. A dropped connection costs nothing — just poll
again.

### 4. Report

```bash
bash "$RR" tail -n 40  # last lines of output (pytest's own summary lands here)
```

Report to the user: **exit code** (`0` = success) plus the tail. On a **non-zero**
exit, `tail` more (`-n 100`) or pull the whole log back for the failing
tracebacks:

```bash
bash "$RR" fetch-log ./cg-remote.log
```

The full log always stays on the remote; only fetch it when needed.

## Housekeeping

```bash
bash "$RR" kill                      # kill the default session
bash "$RR" kill --session cg-remote-train
```

## Notes

- All `ssh` uses `BatchMode=yes` — it never hangs on a password prompt; it fails
  fast instead, which is what preflight detects.
- The command is shipped base64-encoded, so quotes/globs/pipes in it survive intact.
- `uv run` auto-syncs the remote env from `uv.lock` before running, so no separate
  install step is needed.
