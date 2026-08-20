# Meeting-Prepare Coach

A Claude skill that turns a learner's rough draft of what they want to cover into a full mock catch-up meeting with a mentor/supervisor — focused on the learner's own presentation — plus inline English coaching. A higher-stakes, substance-first sibling of `smalltalk`, for a Vietnamese speaker of English. Handles both academic (research supervisor) and workplace (manager) settings.

## Language

**Agenda draft**:
The learner's rough, freeform list of items they want to cover in the meeting — the input that seeds the session.
_Avoid_: Topic, notes, input, talking points, agenda (bare).

**Meeting frame**:
The learner's one-line framing given alongside the agenda draft — who the meeting is with (research supervisor / manager / mentor), its nature (weekly progress, milestone review), and optionally what they tend to care about. Tunes register and the Q&A drill.
_Avoid_: Context, setup, background, scenario.

**Gap check**:
The skill's one bounded pass over the agenda draft before generating — surfacing the 2–4 most important weaknesses (an unsupported claim, a blocker with no ask, a missing next-step) and filling them with visibly-marked assumptions rather than stalling in a long interview.
_Avoid_: Critique, review, audit, validation.

**Prep note**:
The single Markdown note produced per session and saved to the vault, containing the walk-in card, presentation script, Q&A drill, and tighten block.
_Avoid_: Output, document, file, doc, session note.

**Walk-in card**:
The at-a-glance block at the top of the note (headed "🎯 Walk in with this") — Open / Cover (one headline per agenda item) / **Ask** (mandatory, the single most important thing wanted from the mentor) / Close — pulled verbatim from the presentation script for a last-second read outside the door.
_Avoid_: Cheat sheet, summary, TL;DR.

**Presentation script**:
The polished spoken version of the learner's own side of the meeting — opening, progress narration, blocker, and ask — built out from the agenda draft for the learner to rehearse and deliver.
_Avoid_: Monologue, speech, mock conversation, dialogue.

**Q&A drill**:
The essential section pairing the mentor/supervisor's likely probing questions with strong model answers, tuned to the meeting frame, so the learner is ready for what they didn't see coming.
_Avoid_: FAQ, questions, objections.

**Inline coaching**:
Coaching notes attached to the specific lines of the presentation script and Q&A answers where they apply — rather than collected in a detached bottom breakdown. Covers three things: diplomatic phrasing, key vocabulary, and common-mistake catches.
_Avoid_: Annotations, breakdown, footnotes.

**Diplomatic phrasing**:
The star coaching move — how to soften a blocker, disagree with a supervisor politely, hedge a claim, or buy time in professional/academic English. Replaces smalltalk's casual "natural phrasing."
_Avoid_: Politeness, softening, tact.

**Tighten block**:
The compact "⚠️ Tighten before the meeting" section of the note that lists what the gap check found weak, so the learner can fix substance before walking in.
_Avoid_: Warnings, issues, feedback.
