# galley

A local editor for reviewing AI-generated prose and markup. You open a folder of generated files, select a range of text, and attach guidance for the AI agent that will revise it. The guidance is written to disk beside the content so the agent can act on it directly.

## Language

**Draft**:
A single AI-generated file under review (`.md`, `.html`, `.txt`). Editable in place.
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

**Anchor**:
The location a Note is attached to — a text range, recorded with enough surrounding text to be re-found after the Draft changes.
_Avoid_: Selection, position, target, location.

**Orphaned**:
The state of a Note whose Anchor can no longer be found in the Draft, typically because the agent rewrote that passage away.
_Avoid_: Stale, broken, lost, detached.

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
