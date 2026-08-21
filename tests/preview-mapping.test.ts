import { describe, expect, it } from 'vitest'
import { locateBlock, markdownBlocks } from '../src/client/preview/mapping.js'

/**
 * Mapping a passage in the Preview back to the Source it was rendered from.
 *
 * This is the part of pointing at the Preview that can be *silently* wrong: a
 * click that lands on the wrong paragraph looks exactly like one that landed on
 * the right one, and the reviewer only finds out when the agent revises a
 * sentence they never complained about. The visible parts of the feature — the
 * button appearing, the composer opening — fail visibly, and are left to the
 * running app.
 *
 * The mapping is strings in and ranges out, with no DOM in it, so this needs no
 * browser. Prior art and the same justification: `anchor-mapping.test.ts`.
 *
 * Nothing here asserts on how the blocks are walked or what the stamped
 * attribute is called. Both are free to change; where a passage lands is not.
 */

const DRAFT = `# Get started

Install the CLI, then point it at a folder of generated files.

- Run \`galley .\` in the folder
- Open the address it prints

> Nothing leaves your machine.

\`\`\`sh
npx galley ./drafts
\`\`\`

| Format | Preview |
| --- | --- |
| \`.md\` | rendered |
| \`.txt\` | none |

## Get started

That heading appears twice on purpose.
`

/** The Source a block covers, which is the only thing a caller can observe. */
function sourceOf(source: string, block: number): string {
  const located = locateBlock(source, block)
  expect(located.outcome, `block ${block} was not located`).not.toBe('not-found')
  if (located.outcome === 'not-found') throw new Error('unreachable')
  return source.slice(located.from, located.to)
}

describe('the blocks of a Markdown Draft', () => {
  it('covers every construct a Draft actually contains, exactly', () => {
    expect(markdownBlocks(DRAFT).map((block) => DRAFT.slice(block.from, block.to))).toEqual([
      '# Get started',
      'Install the CLI, then point it at a folder of generated files.',
      '- Run `galley .` in the folder\n- Open the address it prints',
      '> Nothing leaves your machine.',
      '```sh\nnpx galley ./drafts\n```',
      '| Format | Preview |\n| --- | --- |\n| `.md` | rendered |\n| `.txt` | none |',
      '## Get started',
      'That heading appears twice on purpose.',
    ])
  })

  it('leaves the gaps between blocks to no block', () => {
    // An Anchor cut from a heading is the heading, not the heading and the
    // blank line under it.
    for (const block of markdownBlocks(DRAFT)) {
      expect(DRAFT.slice(block.from, block.to)).toBe(DRAFT.slice(block.from, block.to).trim())
    }
  })

  it('accounts for the whole Draft in order, without overlapping', () => {
    let previous = 0
    for (const block of markdownBlocks(DRAFT)) {
      expect(block.from).toBeGreaterThanOrEqual(previous)
      expect(block.to).toBeGreaterThan(block.from)
      previous = block.to
    }
    expect(previous).toBeLessThanOrEqual(DRAFT.length)
  })
})

describe('a block the reviewer clicked in the Preview', () => {
  it('maps to that block of the Source', () => {
    expect(sourceOf(DRAFT, 1)).toBe(
      'Install the CLI, then point it at a folder of generated files.',
    )
  })

  it('maps a fenced code block to its fences and everything between', () => {
    expect(sourceOf(DRAFT, 4)).toBe('```sh\nnpx galley ./drafts\n```')
  })

  it('maps a table to every one of its rows', () => {
    expect(sourceOf(DRAFT, 5)).toContain('| `.txt` | none |')
  })

  it('lands on the heading that was clicked, not the first one that reads the same', () => {
    // "Get started" is in the Draft twice. Searching for the text would be a
    // coin toss; the stamped block is not.
    expect(sourceOf(DRAFT, 0)).toBe('# Get started')
    expect(sourceOf(DRAFT, 6)).toBe('## Get started')
  })

  it('says so rather than guessing when there is no such block', () => {
    expect(locateBlock(DRAFT, 99)).toEqual({ outcome: 'not-found' })
  })

  it('has no blocks to offer for an empty Draft', () => {
    expect(markdownBlocks('')).toEqual([])
    expect(locateBlock('', 0)).toEqual({ outcome: 'not-found' })
  })

  it('reports a block outcome, which the caller must not read as an exact one', () => {
    expect(locateBlock(DRAFT, 1).outcome).toBe('block')
  })
})
