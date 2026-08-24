import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// The Desk remembers which folder each Review id means, in a file under
// `GALLEY_HOME`. Tests get their own so a run never touches — or is confused by
// — the Reviews the person running them has open.
process.env.GALLEY_HOME = mkdtempSync(path.join(tmpdir(), 'galley-home-'))
