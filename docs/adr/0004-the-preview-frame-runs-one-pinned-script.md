# The Preview frame runs exactly one script, and it is ours

A reviewer reading a Preview needs to point at a passage and get back to the Source it came from, and a frame with scripting off is deaf — a click inside it produces no event, no selection and no message the app can see. So the Preview frame moves from `sandbox=""` to `sandbox="allow-scripts"`, and its Content-Security-Policy gains a `script-src` naming a nonce minted per rendered document, so the only script that runs is the listener we inject. `allow-same-origin` is deliberately withheld: the frame stays in an opaque origin, unable to reach the app's DOM, its storage, or the local API that writes to disk, and can talk to us only by `postMessage`.

## Considered Options

- **Keep `sandbox=""`** — the strongest posture, and the one the frame shipped with. But there is no way to hear a click, so the feature cannot exist at all.
- **Render the sanitised HTML inline in the app's DOM** — no frame, no sandbox question. Rejected on both counts it was meant to help: a generated Draft's `<style>` blocks would restyle the editor around it, and the browser-level scripting guarantee is gone rather than narrowed.
- **`allow-scripts` with `script-src 'unsafe-inline'`** — the same capability for less work, but any script DOMPurify missed would also run. The nonce costs a line and removes that class of mistake entirely.

## Consequences

- DOMPurify stops being one of three independent layers and becomes one of two. A later edit that loosens the policy — an added `'unsafe-inline'`, a host in a source list — would be exploitable in a way today's frame is not. The policy assertions in `tests/preview-document.test.ts` are what guard this, and they are load-bearing now rather than belt-and-braces.
- Messages arriving from the frame are untrusted input: accepted only when they come from that frame's own `contentWindow`, and validated before anything is done with them.
