# galley

A local editor for reviewing AI-generated prose and markup. You open a folder of generated files, select a range of text, and attach guidance for the AI agent that will revise it. The guidance is written to disk beside the content so the agent can act on it directly.

## Language

**Draft**:
A single AI-generated file under review — prose or markup, in one of the formats galley reads. Editable in place.
_Avoid_: Content, document, artifact, output.

**Source**:
The Draft as it is written — the text of the file itself. Anchors are cut from the Source, and Notes are attached there.
_Avoid_: Raw, code, markdown view, editor.

**Preview**:
The Draft as it reads — rendered, and running nothing of the Draft's own. A passage in the Preview can be pointed back at the Source it came from.
_Avoid_: Rendered view, reading view, output, WYSIWYG.

**Note**:
One piece of guidance a reviewer attaches to a range of a Draft, addressed to the AI agent that will revise it.
_Avoid_: Comment (means `<!-- -->` inside a Draft), feedback, annotation, remark.

**Flag**:
A passage of a Draft the reviewer marked to come back to, addressed to nobody.
The counterpart of a Note: a Note says what to change, a Flag says only that
this needs a second look. It never reaches the agent.
_Avoid_: Comment, TODO, bookmark, marker, highlight.

**Anchor**:
The location a Note is attached to — a text range, recorded with enough surrounding text to be re-found after the Draft changes.
_Avoid_: Selection, position, target, location.

**Located**:
The state of a Note or Flag whose Anchor has been found in the Draft as it stands now — either verbatim, or reworded closely enough to still be the same passage. The counterpart of Orphaned.
_Avoid_: Resolved (that is a Status, and means the reviewer accepted the Note), matched, found, positioned.

**Orphaned**:
The state of a Note or Flag whose Anchor can no longer be found in the Draft, typically because the agent rewrote that passage away.
_Avoid_: Stale, broken, lost, detached.

**Desk**:
The one process serving every open Review, each at its own URL. Started by the first `galley` command that needs it and outliving the terminal that ran it, so several Reviews can be open at once.
_Avoid_: Server, daemon, host, instance.

**Review**:
One folder of Drafts opened together for a single pass of feedback.
_Avoid_: Workspace, project, batch, session.

**Scope**:
How far a Note reaches — a range of a Draft, a whole Draft, or the whole Review.
_Avoid_: Level, target, granularity.

**Kind**:
What a Note asks the agent to do — Fix, Question, or Idea.
_Avoid_: Type, severity, priority, label.

**Reply**:
The agent's written response under a Note, saying what it changed or why it didn't.
_Avoid_: Response, answer, comment, resolution.

**Status**:
Where a Note is in its life — Open, Answered (the agent has replied), or Resolved (the reviewer accepted it).
_Avoid_: State, stage.
