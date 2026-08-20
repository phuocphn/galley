#!/usr/bin/env bash
# remote-run.sh — run any command on the TUM box against a synced mirror of the
# local CircuitGenome tree, kept alive in tmux. See ../SKILL.md for the workflow.
#
# Fixed target (by design — see the skill's CONTEXT.md):
#   local  : /Users/phuocpham/workspace/projects/CircuitGenome
#   remote : pham@10.157.146.6:/home/pham/code/analog-ml/CircuitGenome
#
# Subcommands:
#   preflight                       reachable? tmux/uv/rsync present? checkout there?
#   run [--session S] -- CMD...     rsync the tree, then launch CMD detached in tmux S
#   poll [--session S]              running | done (prints EXIT=N) | idle
#   tail [--session S] [-n N]       last N lines of the remote run log (default 30)
#   fetch-log [--session S] [DEST]  copy the full remote log back locally
#   kill [--session S]              kill the tmux session
#
# Every ssh uses BatchMode=yes: with key auth set up it is silent; without it,
# it fails fast with "Permission denied" instead of hanging on a password prompt.
set -euo pipefail

readonly LOCAL_DIR="/Users/phuocpham/workspace/projects/CircuitGenome"
readonly REMOTE_HOST="pham@10.157.146.6"
readonly REMOTE_DIR="/home/pham/code/analog-ml/CircuitGenome"
readonly DEFAULT_SESSION="cg-remote"
# Run logs live at ~/.remote-run/<session>.log — OUTSIDE the checkout, so rsync --delete never touches them.
# PATH that non-login tmux/ssh shells often miss (uv commonly lives here):
readonly REMOTE_PATH_FIX='export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"'

SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=240 "$REMOTE_HOST")

log_path() { echo "\$HOME/.remote-run/$1.log"; }   # evaluated remotely

die() { echo "remote-run: $*" >&2; exit 1; }

# --- arg parsing helpers -----------------------------------------------------
parse_session() {   # sets SESSION from --session S, leaves remaining args in REST[]
  SESSION="$DEFAULT_SESSION"; REST=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --session) SESSION="$2"; shift 2 ;;
      --) shift; REST+=("$@"); break ;;
      *) REST+=("$1"); shift ;;
    esac
  done
}

# --- subcommands -------------------------------------------------------------
cmd_preflight() {
  "${SSH[@]}" "bash -lc '
    $REMOTE_PATH_FIX
    echo \"host: \$(hostname)\"
    echo \"cpus: \$(nproc 2>/dev/null || echo ?)\"
    for t in tmux uv rsync; do
      if command -v \$t >/dev/null; then echo \"ok:  \$t -> \$(command -v \$t)\"; else echo \"MISSING: \$t\"; fi
    done
    if [ -d \"$REMOTE_DIR\" ]; then echo \"ok:  checkout $REMOTE_DIR\"; else echo \"MISSING: checkout $REMOTE_DIR\"; fi
    mkdir -p \"\$HOME/.remote-run\"
  '" || die "cannot reach $REMOTE_HOST non-interactively. Run: ssh-copy-id -o ServerAliveInterval=240 $REMOTE_HOST"
}

cmd_sync() {
  echo "remote-run: syncing $LOCAL_DIR -> $REMOTE_HOST:$REMOTE_DIR" >&2
  rsync -az --delete \
    -e "ssh -o BatchMode=yes -o ServerAliveInterval=240" \
    --exclude '.git/' --exclude '.venv/' \
    --exclude '__pycache__/' --exclude '.pytest_cache/' \
    "$LOCAL_DIR"/ "$REMOTE_HOST:$REMOTE_DIR"/
}

cmd_run() {
  parse_session "$@"
  [ "${#REST[@]}" -gt 0 ] || die "run needs a command after --  (e.g. run -- uv run pytest)"
  local session="$SESSION"
  local user_cmd="${REST[*]}"

  # Refuse to clobber a live run in this session.
  if "${SSH[@]}" "tmux has-session -t '$session' 2>/dev/null"; then
    echo "remote-run: session '$session' is already busy — not clobbering. Status:" >&2
    cmd_poll --session "$session"
    return 3
  fi

  cmd_sync

  # Ship the command via base64 so no quoting/escaping can corrupt it.
  local b64; b64=$(printf '%s' "$user_cmd" | base64 | tr -d '\n')
  local rlog; rlog="$(log_path "$session")"

  "${SSH[@]}" "bash -lc '
    $REMOTE_PATH_FIX
    mkdir -p \"\$HOME/.remote-run\"
    printf %s \"$b64\" | base64 --decode > \"\$HOME/.remote-run/$session.cmd\"
    tmux new-session -d -s \"$session\" \"$REMOTE_PATH_FIX; cd \\\"$REMOTE_DIR\\\" && bash \\\"\$HOME/.remote-run/$session.cmd\\\" > \\\"$rlog\\\" 2>&1; echo EXIT=\\\$? >> \\\"$rlog\\\"\"
  '"
  echo "remote-run: launched in tmux session '$session'" >&2
  echo "  command : $user_cmd" >&2
  echo "  log     : $REMOTE_HOST:~/.remote-run/$session.log" >&2
}

cmd_poll() {
  parse_session "$@"
  local session="$SESSION"; local rlog; rlog="$(log_path "$session")"
  "${SSH[@]}" "bash -lc '
    line=\$(grep -m1 \"^EXIT=\" \"$rlog\" 2>/dev/null || true)
    if [ -n \"\$line\" ]; then echo \"done \$line\";
    elif tmux has-session -t \"$session\" 2>/dev/null; then echo running;
    else echo idle; fi
  '"
}

cmd_tail() {
  parse_session "$@"
  local n=30; local session="$SESSION"
  set -- "${REST[@]:-}"
  while [ $# -gt 0 ]; do case "$1" in -n) n="$2"; shift 2;; *) shift;; esac; done
  local rlog; rlog="$(log_path "$session")"
  "${SSH[@]}" "tail -n $n '$rlog' 2>/dev/null || echo '(no log yet for session $session)'"
}

cmd_fetch_log() {
  parse_session "$@"
  local session="$SESSION"
  local dest="${REST[0]:-./$session.log}"
  rsync -az -e "ssh -o BatchMode=yes -o ServerAliveInterval=240" \
    "$REMOTE_HOST:\$HOME/.remote-run/$session.log" "$dest"
  echo "remote-run: fetched log -> $dest" >&2
}

cmd_kill() {
  parse_session "$@"
  "${SSH[@]}" "tmux kill-session -t '$SESSION' 2>/dev/null && echo killed '$SESSION' || echo 'no session $SESSION'"
}

# --- dispatch ----------------------------------------------------------------
sub="${1:-}"; shift || true
case "$sub" in
  preflight)  cmd_preflight ;;
  run)        cmd_run "$@" ;;
  poll)       cmd_poll "$@" ;;
  tail)       cmd_tail "$@" ;;
  fetch-log)  cmd_fetch_log "$@" ;;
  kill)       cmd_kill "$@" ;;
  *) die "usage: remote-run.sh {preflight|run -- CMD|poll|tail|fetch-log|kill} [--session S]" ;;
esac
