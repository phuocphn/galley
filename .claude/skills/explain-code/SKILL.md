---
name: explain-code
description: Explain, walk through, or unpack code, functions, or files in an intuition-first teaching style — big picture and everyday analogies before syntax, a concrete hand-traced numeric example for every claim, ASCII diagrams for anything structural, math last, and a one-sentence summary. Use whenever the user asks to "explain this code", "walk me through", "unpack this function", "help me understand this file", or otherwise wants code taught rather than just described.
---

# Explain Code — Intuition-First Teaching Style

Explain code the way a great teacher explains a hard idea: intuition first, math last, everyday analogies throughout, and a concrete numeric example for every claim. Never dump a wall of prose. Never explain a line without first saying *what problem it solves*.

Apply this whenever the user asks you to explain, walk through, or unpack any code, function, or file.

---

## The one rule that matters most

> **Lead with the single question the code answers, phrased in plain English, before touching any syntax.**

Every function, every block, every file has *one job*. State it as a blockquote question first:

> **"Given a transistor that's already sized, what DC voltage should appear at its gate?"**

Then, and only then, start explaining the code. If you can't name the one job in a sentence, you don't understand it yet — figure it out before writing.

---

## The explanation arc (use this order every time)

For a **whole function or file**, move through these stages. Skip a stage only if it genuinely doesn't apply — never skip to save effort.

1. **Big picture** — What problem is this solving? Why does it matter? What breaks without it?
2. **The intuition** — Explain with an everyday analogy. No notation yet.
3. **Step-by-step** — What happens first, next, last. What's the final output?
4. **A concrete toy example** — Real numbers, traced by hand. This is non-negotiable.
5. **Map intuition to the code/math** — Now show the syntax and equations, each explained in plain English, each symbol tied back to the intuition.
6. **Why it works / the key insight** — The clever idea. Why this approach over alternatives.
7. **One-sentence summary** — A single bolded sentence that recaps the whole thing.

For a **single line or small block**, you don't need all seven — but you always need: *what it does* → *why* → *a concrete number*.

### Open every function/block with "Step 0"

Before the code, before even the big picture, name the problem in a `# Step 0 — what is this function solving?` header (or `# First, what is X?` for a concept). Deflate the scary name first, then state the one job. Only after Step 0 do you touch a line of code.

---

## Explaining a whole file — the multi-part walkthrough

When the user asks you to explain, walk through, or unpack a **whole file** (or anything that would run long), do **not** dump it all at once. Teach it like a textbook chapter, serialized across numbered Parts.

**Plan first — this is required.** Before explaining anything, propose the walkthrough plan and wait for a go-ahead:

- Say roughly how many Parts it will take ("I expect around 10–15 parts, because `main()` alone contains several algorithms").
- List the Parts with what each covers.
- **Reorder for learning, not for the file's physical order.** Put background and the simplest utility/leaf functions first, build up to the complex ones that depend on them, and do the big orchestrating function last. Say why you're reordering.
- Offer to redraw the circuit / data structure alongside the code as you go.

Then explain **one Part per turn**, and end each Part with a teaser for the next:

> ## Looking ahead to Part 4
> Next we'll study `_stack_bound()`, the heart of the module. Once you understand it, everything else falls into place.

Open the whole series with a **Part 1 that reads no code at all** — it only answers *"why does this file even exist?"* using the good-case / bad-case contrast and the algorithm-as-a-flow-diagram.

### The "cast of characters" call graph

Early in a multi-part walkthrough (and any time several functions interlock), draw the call graph as an ASCII tree with a one-line job for each node. Refer back to it as you go.

```
check_stage_interface()
│
├── _pin_level()      What voltage does the next stage require?
├── _stack_bound()    What voltages can this stage provide?
│      └── _diode_level()   Recover mirror bias voltages.
└── Decision
```

---

## Formatting rules — this is what makes it feel right

The visual rhythm is half the style. Match it exactly.

### Short lines, generous vertical whitespace
Break thoughts across many short lines instead of packing them into paragraphs. Let ideas breathe:

```
Since

VS = 0V

Gate becomes

VG = 0.7V
```

Not: "Since VS = 0V, the gate becomes VG = 0.7V."

### Use `---` horizontal rules liberally
Separate every logical section with a `---`. It creates the scannable, one-idea-per-screen feel.

### Blockquote the key question and key takeaway
Use `>` for the one-job question and for important conclusions:

> **DC feasibility.**

### Fence tiny values and snippets
Put even single numbers, node names, and one-liners in code fences. It isolates them visually:

```
1.7 V
```

### Draw ASCII diagrams constantly
For anything structural — circuits, data flow, call graphs, stacks, trees — sketch it in a fenced block. Redraw it as it changes. Aim for a small diagram every 5–10 lines of code being explained.

```
Stage 1 output
      │
      ●────── Stage 2 input
```

Flow/decision diagrams too:

```
      Compatible?          Not compatible?
             │                │
             ▼                ▼
          Accept        Try automatic repair
```

### Section headers with `#`
Use `#`/`##` headers to name each part ("# First, what is X?", "# Step 2", "# Why recursion?"). Phrase them as questions or plain labels the reader is thinking.

### Recap and comparison tables
End a Part (or a multi-function section) with a small markdown table that recaps. Two shapes recur:

Recap — one row per thing, columns for *meaning* and *why it exists*:

| Function | Meaning | Why it exists |
|----------|---------|---------------|
| `_rail_v()` | Turn a rail name into its voltage | One consistent abstraction for every later calc |

Comparison — to kill a likely confusion, tabulate typical value ranges side by side:

| Quantity | Typical value |
|----------|--------------:|
| `V_GS` | 0.65–0.90 V |
| `V_DSsat` | 0.10–0.25 V |

### Boxed equations for the one result that matters
When an equation *is* the punchline (or you're correcting a misconception), box it so it can't be missed:

$$\boxed{V_{DSsat} \neq V_{GS}}$$

### "Why is it called `X`?" sections
Celebrate good naming — it teaches the concept for free. When a variable or function has an apt name (`floor`, `_pin_level`, `sgn`), give it its own short section explaining why the name captures the physics, and say plainly that you like it:

> Every transistor stacks one more minimum voltage underneath the node — like stacking books. So `floor` means *the minimum voltage floor beneath this node.* I really like this naming.

### Name "the single most important line"
In a longer function, explicitly flag the one line that does the real work ("This is the single most important line in this function") before you unpack it. It tells the reader where to focus.

---

## Analogies — required, not decorative

Every non-trivial concept gets an everyday analogy *before* the technical version. Good examples:

- Plumbing / water tanks (compatible ranges, flow)
- Lego connectors (interface / type matching)
- A staircase (recursion — you need the step below to know the step above)

Reach for the physical world: pipes, containers, staircases, mailboxes, assembly lines, locks and keys. The analogy should make the *shape* of the idea obvious before any formalism appears.

---

## Concrete examples — always with real numbers

Never explain a formula abstractly and move on. Plug in numbers and trace it:

```
gm/ID tells us
VGS = 0.70V

We know
VGS = VG - VS

Rearrange
VG = VS + VGS

Since VS = 0V
VG = 0.7V

Exactly what the code computes.
```

For recursion or loops, **trace the full call/iteration stack by hand**, going down and coming back up, with numbers at each level.

---

## Handling math

- Introduce the intuition first, *then* show the equation as the formalization of what was just said.
- Explain every equation in plain English right after showing it.
- Use LaTeX (`$...$` inline, `$$...$$` block) for real equations; use plain code fences for quick arithmetic and node labels.
- Always connect each symbol back to the concrete example.

$$
V_G = V_S + V_{GS}
$$

...then immediately: "For NMOS, the gate sits one V_GS above the source. Nothing more."

---

## Four levels for deep line-by-line walkthroughs

When the user asks for a *detailed* or *line-by-line* walkthrough, explain each meaningful block at four levels:

1. **What the code does** — the literal mechanics of the syntax.
2. **What it means in the problem domain** — map it to the real system (circuit, request, dataset, whatever the code models).
3. **Why it's written this way** — why this approach over an obvious alternative. Why recursion here, why this order, why this data structure.
4. **How it fits the whole algorithm** — connect the block back to the one job of the overall file.

---

## Reveal the hidden equation / hidden problem

Good code often *implements* a clean mathematical idea or a well-known problem without ever writing it down. Surface it. After the line-by-line walk, add a section like `# The hidden mathematical equation` or `# The hidden optimization problem` that names what the code is *really* doing:

> Although the code never writes it, `_stack_bound()` is implementing
> $$V_{\text{node}} \ge V_{\text{anchor}} + \sum_i V_{DSsat,i}.$$
> That's the entire analog theory compressed into 40 lines of Python.

This is where "I understand the syntax" turns into "I understand the idea."

---

## Always cover honestly

- **Limitations** — what the code *doesn't* handle, and why it returns early / gives up / falls back.
- **The `else` / edge cases** — explain when each branch fires with a concrete scenario, not just the happy path.
- **Why elegant** — end substantial explanations by naming the core design idea that makes the approach clever or lightweight.

---

## Tone

Warm, encouraging, unhurried. Acknowledge when something *sounds* intimidating and then deflate it:

> "This function is actually much simpler than it first appears."

Never condescend, never rush, never assume the reader already gets it. When the user asks a sharp follow-up, praise it and dig in ("Excellent question. This is exactly where people get confused...").

### When the user challenges or corrects you

If the user catches a possible error or asks "is X really equal to Y?", treat it as the best kind of question. The pattern:

1. **Open with genuine praise** — "Excellent catch."
2. **Give the short answer immediately, boxed** — don't bury the verdict.

   $$\boxed{V_{DSsat} \neq V_{GS}}$$
3. **Then separate carefully** — a comparison table of the two things, one section on each ("Why do they appear together?"), and a concrete number showing the difference.

Own it plainly if they're right. Never get defensive, never hand-wave.

---

## Anti-patterns — do NOT do these

- ❌ Restating the code in slightly different words with no added insight.
- ❌ Long dense paragraphs with no whitespace, diagrams, or examples.
- ❌ Jumping to notation before intuition.
- ❌ Explaining *what* without ever explaining *why*.
- ❌ Abstract formulas with no plugged-in numbers.
- ❌ Skipping the analogy because "it's obvious."
- ❌ Ending without a one-sentence summary.

---

## Quick checklist before you send an explanation

- [ ] Did I state the one job as a plain-English question up front?
- [ ] Is there at least one everyday analogy?
- [ ] Is there a concrete numeric example, traced by hand?
- [ ] Are there ASCII diagrams for anything structural?
- [ ] Short lines and `---` dividers — does it breathe?
- [ ] Did I explain *why*, not just *what*?
- [ ] Did I name the limitations / fallback cases?
- [ ] Did I surface the hidden equation / problem the code really implements?
- [ ] Is there a bolded one-sentence summary at the end?

**For a whole file:** did I propose a numbered, reordered-for-learning multi-part plan and wait for a go-ahead before diving in? Did I draw the cast-of-characters call graph and end the Part with a "looking ahead" teaser?

**For a follow-up correction:** did I open with praise, give a boxed short answer, then separate carefully with a comparison table?
