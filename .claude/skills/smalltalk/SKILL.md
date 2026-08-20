---
name: smalltalk
description: Turn a short everyday topic into a mock coworker small-talk conversation plus an English coaching breakdown, saved as a note in the Obsidian vault. Use when the user wants to prep for casual small talk (e.g. the walk to lunch), types /smalltalk <topic>, or asks to practice/prepare English small talk about something.
---

# Small-Talk English Coach

Turn one short **Topic** into a mock small-talk conversation plus a coaching **Breakdown**, then save it as a note in the vault. The learner is a **Vietnamese speaker of English** prepping for casual coworker small talk — the daily walk to lunch.

## Input

The user gives a **Topic**: a news item, something about a person, an event, or anything they want to share. It may be terse (`/smalltalk EV charging prices`) or a sentence (`my coworker just got back from Japan`). If no Topic is given, ask for one in a single line.

## What to produce

One Markdown note, following the template below **exactly** in this order. Write it to the vault at:

```
smalltalk/<YYYY-MM-DD>-<topic-slug>.md
```

- `<YYYY-MM-DD>` = today's date. `<topic-slug>` = the Topic lowercased, kebab-cased, ~3–5 words.
- The vault root is the repository root (where this `.claude/` dir lives). Create the `smalltalk/` folder if it doesn't exist.
- After writing the file, also show the full note in chat. Then the session is done — do **not** offer roleplay or drills.

## Generation rules

**Register** — Natural, casual, **American** native English: contractions, filler, idioms, trailing-off. How coworkers actually talk on a walk. The breakdown decodes anything tricky; don't dumb the conversation down.

**Mock conversation** — One realistic exchange, **6–10 turns**, two speakers: `You` (the learner, who initiates by sharing the Topic) and `Coworker`. Arc: opener → hook (drop the topic) → reaction → back-and-forth → graceful exit toward lunch.

**Cheat sheet (🍽️ Before lunch)** — 3–5 lines for a last-second glance: the opener line, 2–3 key phrases to deploy, one exit line. Pull these verbatim from the conversation.

**Structure** — Two sub-blocks:
- *Flow* — the move-by-move skeleton (opener → hook → reaction → follow-up → exit), one line each, so the skeleton is reusable for any topic.
- *Patterns* — 3–5 reusable fill-in-the-blank sentence frames drawn from the lines, e.g. `"Did you catch [event] last night?"`, `"I can't believe they [past verb]."`

**Vocabulary** — 5–8 key words/phrases from the conversation. Each entry, one line:
`**phrase** /IPA/ [register] — Vietnamese gloss. _"natural example sentence."_`
- IPA with stress; call out final consonants Vietnamese speakers drop.
- register = `casual` / `neutral` / `slang`.

**Natural phrasing** — 3–4 items, each contrasting a stiff/textbook version against the natural one:
`- ❌ "stiff version" → ✅ "natural version" — (one-line why)`

**Common mistakes** — Two labeled sub-blocks, kept separate for easy scanning:
- *(A) Interference errors* — mistakes Vietnamese speakers typically make, relevant to this conversation: dropped articles (a/the), missing plural -s, unmarked past tense, wrong/missing prepositions, dropped final consonants. Show ❌ wrong → ✅ right with a short `(VN: …)` note.
- *(B) Topic traps* — mistakes tied to this conversation's specific vocab/phrasing regardless of L1: false friends, collocation errors, uncountable nouns, wrong register for these exact words.

## Note template

```markdown
---
date: <YYYY-MM-DD>
topic: <the Topic, as given>
tags: [smalltalk, vocab, <1-2 topic tags>]
---

# <Topic — short human title>

## 🍽️ Before lunch
- **Open:** "<opener line>"
- **Use:** "<key phrase>" · "<key phrase>"
- **Exit:** "<exit line>"

## Mock conversation
**You:** ...
**Coworker:** ...
_(6–10 turns total)_

## Structure
### Flow
1. Opener — ...
2. Hook — ...
3. Reaction — ...
4. Follow-up — ...
5. Exit — ...
### Patterns
- "..."
- "..."

## Vocabulary
- **phrase** /IPA/ [casual] — Vietnamese gloss. _"example."_

## Natural phrasing
- ❌ "stiff" → ✅ "natural" — why.

## Common mistakes
### A. Vietnamese-interference errors
- ❌ "..." → ✅ "..." (VN: ...)
### B. Topic traps
- ❌ "..." → ✅ "..." (why)
```

## Tone

Warm and encouraging, never condescending. The learner is capable; you're a sharp friend who happens to be a native speaker.
