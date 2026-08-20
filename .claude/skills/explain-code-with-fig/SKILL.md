---
name: explain-code-with-fig
description: Explain code as a standalone HTML webpage with hand-authored SVG figures — the intuition-first teaching of explain-code, rendered visually. Use ONLY when the user explicitly asks for figures, an HTML page, a visual/illustrated explanation, or names this skill (e.g. "explain this with figures", "make me a visual walkthrough", "explain this as a webpage"). For a plain terminal explanation, use explain-code instead.
---

# Explain Code — With Figures (HTML + SVG)

This skill teaches code in **exactly** the intuition-first style of [`explain-code`](../explain-code/SKILL.md), but the deliverable is a **standalone HTML webpage with hand-authored SVG figures** instead of terminal markdown + ASCII.

> **Read `../explain-code/SKILL.md` first.** Its teaching arc, tone, analogies, concrete-numbers rule, hidden-equation reveal, and anti-patterns all apply here unchanged. This file documents only what is *different* because the medium is a webpage.

---

## The one thing that does not change

The pedagogy. Everything `explain-code` mandates still holds:

- Lead with the one-job question in plain English (the `Step 0` deflation).
- The 7-stage arc: big picture → intuition → step-by-step → **concrete numeric example traced by hand** → map to code → key insight → one-sentence summary.
- Everyday analogies before notation. Real numbers for every claim. Honest limitations. Reveal the hidden equation/problem.
- Reorder for *learning*, not the file's physical order. Simplest leaves first, orchestrator last.

If you find yourself producing pretty figures without the teaching arc underneath, stop — you've missed the point. **Figures serve the intuition; they never replace it.**

---

## What changes: the medium

### 1. Output is one HTML file on disk

Write the finished page to:

```
outputs/explain-code-with-fig/YYYY_MM_DD_<slug>_explained.html
```

- `YYYY_MM_DD` is today's date. `<slug>` is a short kebab-case name for what was explained (`quicksort`, `stack-bound`, `use-effect`).
- Create the `outputs/explain-code-with-fig/` directory if it doesn't exist.
- **Always print the final path** at the end so the user can open it.
- The file is fully **self-contained**: inline CSS, inline JS, inline SVG. No external fonts, scripts, images, or CDNs — it must work offline forever.

### 2. Workflow: plan-gate, then one-shot page

Unlike `explain-code`, which serializes one Part per turn, this skill:

1. **Proposes the plan and waits for a go-ahead** (this gate is where the reorder-for-learning thinking happens — do not skip it). The plan states:
   - Roughly how many Parts, and what each covers.
   - Why you reordered.
   - Which figures you intend to draw (name the structural figures).
   - **For large inputs** (say the plan exceeds ~8–10 Parts): offer a split into an index page + linked per-Part-group pages. Let the user decide. Otherwise default to one page with an in-page sticky table of contents.
2. **After go-ahead, build the complete page in one pass.** Don't dribble it out Part-by-Part.

### 3. Figure philosophy: SVG for structure, HTML for text

> **If the meaning lives in 2-D spatial relationships, it's an SVG. If it's linear text, it stays HTML.**

| Render as **SVG** | Render as **native HTML** |
|---|---|
| Call graph, recursion/iteration trace, stack, tree | Prose |
| Circuit, data flow, pipeline, timeline | Recap & comparison **tables** |
| Geometry, before/after state transitions | **Code blocks** (`<pre>`, hand-rolled CSS highlighting) |
| Anything you'd have drawn in ASCII | Boxed **equations** (MathML + CSS) |

Keep `explain-code`'s cadence — a **small figure every 5–10 lines** of code being explained — but only where a diagram genuinely beats prose. Every figure carries a **one-line caption/takeaway** underneath (the visual equivalent of `explain-code`'s "blockquote the takeaway").

The **cast-of-characters call graph** from `explain-code` becomes the first hero SVG.

### 4. Static-first, lightly interactive

Figures are static SVG by default and must each work as a **screenshot**. Add interactivity *only* where it teaches:

- Hover a call-graph node → highlight its edges.
- Click through a recursion trace one frame at a time.
- Collapsible Part sections.

Never animate for decoration. If a figure needs JS to make sense at all, it's probably the wrong figure.

### 5. Math: MathML + CSS, no library

- Simple inline math: plain HTML — `<sub>`/`<sup>` and Unicode (`≠`, `≥`, `Σ`, `√`).
- Genuinely 2-D math (fractions, big operators): hand-written **MathML**.
- The punchline "boxed" equation: `<div class="boxed-eq">…</div>` (styled border), mirroring `explain-code`'s `$\boxed{…}$`.

### 6. Theming: light/dark toggle

The page ships a theme **toggle button**. This imposes one hard rule on figures:

> **Every SVG draws with `currentColor` and CSS variables (`var(--fig-stroke)`, `var(--fig-accent)`, …) — never hard-coded hex.**

The toggle stamps `data-theme="light|dark"` on `:root`; CSS variables cascade into inline SVG. See ADR-0003.

---

## Use the scaffold — don't reinvent it

The medium-specific weight is solved once in two shipped files. **Start from them every time.**

- **[`template.html`](./template.html)** — the page shell: theme variables for both themes, the toggle script, base typography, sticky table-of-contents, `.boxed-eq`, code-highlighting CSS, and figure/caption styles. Fill your content into the marked regions; do not re-derive the CSS.
- **[`svg-cookbook.md`](./svg-cookbook.md)** — copy-paste-ready, themeable SVG patterns (call graph, recursion trace, stack frames, data flow, before/after). Every pattern already uses the CSS-variable palette. Adapt a pattern rather than drawing from scratch; if you invent a new figure type, use the variable palette or it breaks in one theme.

---

## Build checklist

Everything in `explain-code`'s checklist, plus:

- [ ] Did I gate on the plan (with the figure list and any split offer) and wait for go-ahead?
- [ ] Is the file self-contained — inline CSS/JS/SVG, no external anything?
- [ ] Is the first hero figure the cast-of-characters call graph?
- [ ] Does every structural idea get an SVG, and every SVG a one-line caption?
- [ ] Do all figures use CSS variables / `currentColor` (survive the theme toggle)?
- [ ] Does every figure still read as a static screenshot?
- [ ] Did I write to `outputs/explain-code-with-fig/YYYY_MM_DD_<slug>_explained.html` and print the path?
