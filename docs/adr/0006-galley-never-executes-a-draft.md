# galley never executes a Draft

A Draft is under review precisely because nobody has vouched for it yet, and some formats can only be rendered by running them. LaTeX is the first: `.tex` and `.bib` are Drafts galley opens, edits and anchors Notes in, but neither gets a Preview. The reviewer reads the Source, with `stex` highlighting on the `.tex`.

ADR 0004 drew this line inside the Preview frame, where the Draft's own scripts do not run. This extends the same line outward: galley will not run a Draft on the host machine either. A LaTeX Preview would mean compiling, and TeX is a programming language — `\write18` shells out, `\openout` writes files, `\input` reads any path the reviewer can. Running that over generated text nobody has read yet is the thing the Preview was built not to do.

## Considered Options

- **Bundle a WASM TeX engine** (SwiftLaTeX, texlive.js) — the compile is contained by the browser, so the security question mostly goes away. Rejected on fidelity: the engine ships its own package set and fonts, so a paper that builds in the reviewer's terminal may not build here, and one that builds may not match. A Preview that renders a *different* paper is worse than none, because nothing tells the reviewer which one they are looking at. It is also megabytes, against a `.tex` file that is often a fragment with no preamble to compile.
- **Shell out to the reviewer's own TeX** — the best-looking option, and the one that got furthest. It renders the real paper with the real packages, and `--synctex=1` yields an exact PDF-position → source-line map, which would make Preview-to-Source mapping stronger for LaTeX than it is for Markdown (ADR 0005). Rejected on what it costs to get there: galley would be executing an AI-generated file, unprompted, as a side effect of the reviewer clicking a toggle.
- **Approximate the render** — parse the `.tex`, emit HTML for sections, paragraphs and lists, typeset the maths with KaTeX. No execution and no dependency on a TeX install, but it silently disagrees with `pdflatex` wherever a macro, package or custom environment is involved, which in a real paper is everywhere. A third rendering path whose failure mode is looking plausible and being wrong.

## Consequences

- `previewKindFor` returns `null` for `.tex` and `.bib`, so they take the path `.txt` already takes: no toggle, and the Source shown while preview mode is on. Nothing in `preview/mapping.ts` or `preview/render.ts` learns a third format.
- Anchors are pure text (ADR 0002), so Notes, Scopes, Replies and re-anchoring work on a `.tex` Draft with no format-specific code anywhere. Adding a format is one entry in `DRAFT_EXTENSIONS`; that is the property this decision protects.
- The reviewer keeps their own compile loop — their editor, `latexmk -pvc`, Overleaf — running beside galley. galley is where the Notes are, not where the PDF comes from.
- If a Preview is ever wanted here, this is the ADR to overturn, and the argument has to be about executing a Draft rather than about LaTeX. A rendered-elsewhere artefact the reviewer points galley at — a PDF galley displays but never produced — would not overturn it.
