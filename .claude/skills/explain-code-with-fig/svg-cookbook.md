# SVG Cookbook — themeable structural figures

Copy-paste-ready SVG patterns for `explain-code-with-fig`. **Adapt a pattern — don't draw from scratch.**

## The one hard rule

> Draw with `var(--fig-*)` and `currentColor` **only**. Never a raw hex color. This is what lets figures survive the light/dark toggle (ADR-0003).

The palette (defined in `template.html`):

| Variable | Use for |
|----------|---------|
| `--fig-bg` | figure background fills |
| `--fig-stroke` | default lines, borders, arrowheads |
| `--fig-muted` | secondary/inactive lines, grid, "given" state |
| `--fig-accent` | the thing to look at (primary highlight) |
| `--fig-accent2` | a second, contrasting highlight |
| `--fig-fill` / `--fig-fill2` | soft box fills tied to the two accents |
| `--fig-text` | all `<text>` (already the default fill inside `figure.fig`) |

Conventions:
- `viewBox` always set; never a fixed pixel `width`/`height` on `<svg>` (the CSS caps width and keeps it responsive).
- Wrap every figure in `<figure class="fig">…<figcaption>one-line takeaway</figcaption></figure>`.
- Add `role="img"` and `aria-label` for accessibility.
- `stroke-width="2"` reads well at typical sizes.

---

## 0. Shared arrowhead marker

Put one `<defs>` near the top of the first figure, or repeat per-svg. Markers use `context-stroke` so the arrowhead matches the line's color automatically.

```html
<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7"
          orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/>
  </marker>
</defs>
```

Attach with `marker-end="url(#arrow)"` on any `<line>`/`<path>`.

---

## 1. Cast-of-characters call graph (the first hero figure)

The `explain-code` call-graph tree, but drawn. Mark nodes `.node` + `data-group` and edges `.edge` + `data-group`, then add `interactive` to the `<figure>` for hover-highlight.

```html
<figure class="fig interactive" >
  <svg viewBox="0 0 520 260" role="img" aria-label="Call graph">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7"
              orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker>
    </defs>

    <!-- edges (draw first so nodes sit on top) -->
    <line class="edge" data-group="pin"   x1="150" y1="60" x2="110" y2="120"
          stroke="var(--fig-muted)" stroke-width="2" marker-end="url(#arrow)"/>
    <line class="edge" data-group="stack" x1="200" y1="60" x2="300" y2="120"
          stroke="var(--fig-muted)" stroke-width="2" marker-end="url(#arrow)"/>
    <line class="edge" data-group="diode" x1="300" y1="150" x2="300" y2="200"
          stroke="var(--fig-muted)" stroke-width="2" marker-end="url(#arrow)"/>

    <!-- root -->
    <g class="node" data-group="root">
      <rect x="120" y="20" width="180" height="40" rx="8"
            fill="var(--fig-fill)" stroke="var(--fig-accent)" stroke-width="2"/>
      <text x="210" y="45" text-anchor="middle" font-weight="600">check_interface()</text>
    </g>

    <!-- child: pin level -->
    <g class="node" data-group="pin">
      <rect x="30" y="120" width="160" height="46" rx="8"
            fill="var(--fig-bg)" stroke="var(--fig-stroke)" stroke-width="2"/>
      <text x="110" y="140" text-anchor="middle" font-weight="600">_pin_level()</text>
      <text x="110" y="157" text-anchor="middle" font-size="11" fill="var(--fig-muted)">what does the next stage need?</text>
    </g>

    <!-- child: stack bound -->
    <g class="node" data-group="stack">
      <rect x="220" y="120" width="160" height="46" rx="8"
            fill="var(--fig-bg)" stroke="var(--fig-stroke)" stroke-width="2"/>
      <text x="300" y="140" text-anchor="middle" font-weight="600">_stack_bound()</text>
      <text x="300" y="157" text-anchor="middle" font-size="11" fill="var(--fig-muted)">what can this stage provide?</text>
    </g>

    <!-- grandchild: diode -->
    <g class="node" data-group="diode">
      <rect x="230" y="200" width="140" height="40" rx="8"
            fill="var(--fig-bg)" stroke="var(--fig-stroke)" stroke-width="2"/>
      <text x="300" y="225" text-anchor="middle" font-weight="600">_diode_level()</text>
    </g>
  </svg>
  <figcaption>Who calls whom — and the one-line job of each. Hover a box to trace its link.</figcaption>
</figure>
```

To make the hover-highlight light up a node *and* its edge together, give them the **same** `data-group`. (The template's script dims everything else.)

---

## 2. Recursion / iteration trace (going down, coming back up)

The most important figure for recursion. Stack of frames descending, values returning.

```html
<figure class="fig">
  <svg viewBox="0 0 480 240" role="img" aria-label="Recursion trace of fact(3)">
    <!-- descending calls -->
    <g font-size="13">
      <rect x="20"  y="20"  width="150" height="34" rx="6" fill="var(--fig-fill)"  stroke="var(--fig-stroke)" stroke-width="2"/>
      <text x="95"  y="42"  text-anchor="middle">fact(3) → 3 · fact(2)</text>
      <rect x="60"  y="70"  width="150" height="34" rx="6" fill="var(--fig-fill)"  stroke="var(--fig-stroke)" stroke-width="2"/>
      <text x="135" y="92"  text-anchor="middle">fact(2) → 2 · fact(1)</text>
      <rect x="100" y="120" width="150" height="34" rx="6" fill="var(--fig-fill2)" stroke="var(--fig-accent2)" stroke-width="2"/>
      <text x="175" y="142" text-anchor="middle">fact(1) → 1  (base)</text>
    </g>
    <!-- returns climbing back -->
    <g stroke="var(--fig-accent)" stroke-width="2" fill="none">
      <path d="M270,137 C340,137 340,92 300,92"  marker-end="url(#arrow)"/>
      <path d="M300,87  C370,87  370,42 250,42"  marker-end="url(#arrow)"/>
    </g>
    <text x="360" y="120" font-size="12" fill="var(--fig-accent)">returns 1</text>
    <text x="390" y="70"  font-size="12" fill="var(--fig-accent)">returns 2</text>
    <text x="300" y="200" font-size="13" fill="var(--fig-accent)" font-weight="600">fact(3) = 6</text>
  </svg>
  <figcaption>Calls descend (left), the base case flips it, values multiply on the way back up.</figcaption>
</figure>
```

---

## 3. Stack / array of cells (indexed state)

For arrays, buffers, call stacks, memo tables. Highlight the active cell with the accent.

```html
<figure class="fig">
  <svg viewBox="0 0 420 90" role="img" aria-label="Array with pivot highlighted">
    <g font-size="14" text-anchor="middle">
      <!-- repeat per cell; shift x by 60 -->
      <rect x="10"  y="20" width="56" height="40" fill="var(--fig-bg)"    stroke="var(--fig-stroke)" stroke-width="2"/>
      <text x="38"  y="45">5</text><text x="38"  y="78" font-size="11" fill="var(--fig-muted)">0</text>
      <rect x="70"  y="20" width="56" height="40" fill="var(--fig-fill)"  stroke="var(--fig-accent)" stroke-width="3"/>
      <text x="98"  y="45" font-weight="600">3</text><text x="98" y="78" font-size="11" fill="var(--fig-accent)">pivot</text>
      <rect x="130" y="20" width="56" height="40" fill="var(--fig-bg)"    stroke="var(--fig-stroke)" stroke-width="2"/>
      <text x="158" y="45">8</text><text x="158" y="78" font-size="11" fill="var(--fig-muted)">2</text>
      <rect x="190" y="20" width="56" height="40" fill="var(--fig-bg)"    stroke="var(--fig-stroke)" stroke-width="2"/>
      <text x="218" y="45">1</text><text x="218" y="78" font-size="11" fill="var(--fig-muted)">3</text>
    </g>
  </svg>
  <figcaption>The pivot cell, called out in the accent color; indices sit underneath.</figcaption>
</figure>
```

---

## 4. Data flow / pipeline (left-to-right stages)

For request pipelines, transforms, assembly-line processing.

```html
<figure class="fig">
  <svg viewBox="0 0 500 100" role="img" aria-label="Data pipeline">
    <g text-anchor="middle" font-size="13">
      <rect x="10"  y="30" width="110" height="44" rx="8" fill="var(--fig-fill)"  stroke="var(--fig-stroke)" stroke-width="2"/>
      <text x="65"  y="57">raw input</text>
      <rect x="195" y="30" width="110" height="44" rx="8" fill="var(--fig-fill)"  stroke="var(--fig-stroke)" stroke-width="2"/>
      <text x="250" y="52">parse</text><text x="250" y="68" font-size="11" fill="var(--fig-muted)">tokenize</text>
      <rect x="380" y="30" width="110" height="44" rx="8" fill="var(--fig-fill2)" stroke="var(--fig-accent2)" stroke-width="2"/>
      <text x="435" y="57">result</text>
    </g>
    <g stroke="var(--fig-stroke)" stroke-width="2">
      <line x1="120" y1="52" x2="195" y2="52" marker-end="url(#arrow)"/>
      <line x1="305" y1="52" x2="380" y2="52" marker-end="url(#arrow)"/>
    </g>
  </svg>
  <figcaption>Each stage's output is the next stage's input — one arrow, one transform.</figcaption>
</figure>
```

---

## 5. Before / after state transition

For mutations, swaps, rebalancing — show two snapshots with the change in accent.

```html
<figure class="fig">
  <svg viewBox="0 0 460 130" role="img" aria-label="Before and after a swap">
    <text x="90"  y="20" text-anchor="middle" font-size="12" fill="var(--fig-muted)">before</text>
    <text x="370" y="20" text-anchor="middle" font-size="12" fill="var(--fig-muted)">after</text>
    <!-- before -->
    <g font-size="14" text-anchor="middle">
      <rect x="30"  y="35" width="50" height="40" fill="var(--fig-fill)" stroke="var(--fig-accent)" stroke-width="2"/><text x="55"  y="60">a</text>
      <rect x="100" y="35" width="50" height="40" fill="var(--fig-fill)" stroke="var(--fig-accent)" stroke-width="2"/><text x="125" y="60">b</text>
    </g>
    <line x1="185" y1="55" x2="255" y2="55" stroke="var(--fig-stroke)" stroke-width="2" marker-end="url(#arrow)"/>
    <text x="220" y="45" text-anchor="middle" font-size="11" fill="var(--fig-muted)">swap</text>
    <!-- after -->
    <g font-size="14" text-anchor="middle">
      <rect x="290" y="35" width="50" height="40" fill="var(--fig-fill2)" stroke="var(--fig-accent2)" stroke-width="2"/><text x="315" y="60">b</text>
      <rect x="360" y="35" width="50" height="40" fill="var(--fig-fill2)" stroke="var(--fig-accent2)" stroke-width="2"/><text x="385" y="60">a</text>
    </g>
  </svg>
  <figcaption>Same two cells, contents swapped — the accent color marks what moved.</figcaption>
</figure>
```

---

## 6. Decision / branch diagram

For `if/else`, compatibility checks, the "happy path vs fallback" contrast `explain-code` loves.

```html
<figure class="fig">
  <svg viewBox="0 0 420 170" role="img" aria-label="Decision branch">
    <polygon points="210,15 290,55 210,95 130,55" fill="var(--fig-fill)" stroke="var(--fig-stroke)" stroke-width="2"/>
    <text x="210" y="60" text-anchor="middle" font-size="13">compatible?</text>
    <g stroke="var(--fig-stroke)" stroke-width="2">
      <line x1="150" y1="80" x2="90"  y2="120" marker-end="url(#arrow)"/>
      <line x1="270" y1="80" x2="330" y2="120" marker-end="url(#arrow)"/>
    </g>
    <text x="120" y="105" font-size="11" fill="var(--fig-muted)">yes</text>
    <text x="300" y="105" font-size="11" fill="var(--fig-muted)">no</text>
    <rect x="30"  y="120" width="120" height="38" rx="8" fill="var(--fig-fill2)" stroke="var(--fig-accent2)" stroke-width="2"/>
    <text x="90"  y="144" text-anchor="middle" font-size="13">accept</text>
    <rect x="270" y="120" width="120" height="38" rx="8" fill="var(--fig-fill)" stroke="var(--fig-accent)" stroke-width="2"/>
    <text x="330" y="144" text-anchor="middle" font-size="13">repair</text>
  </svg>
  <figcaption>The fork and where each branch lands — happy path left, fallback right.</figcaption>
</figure>
```

---

## Adding a new pattern

If none fit, build one — but keep the rules: `viewBox` (no fixed px), `var(--fig-*)`/`currentColor` only, a `<figcaption>` takeaway, and `role`/`aria-label`. Test it by flipping the theme toggle; if anything vanishes or turns muddy, you hard-coded a color somewhere.
