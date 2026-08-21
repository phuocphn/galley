import { describe, expect, it } from 'vitest'
import { locateBlock, locatePhrase, markdownBlocks } from '../src/client/preview/mapping.js'

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

/** A selection the reviewer made inside one rendered block. */
function inBlock(block: number, text: string) {
  return { start: { block, text }, end: { block, text } }
}

const PROSE = `## Pricing

Every plan is **billed monthly**, and you can cancel at any time.

The Pro plan adds [priority support](https://example.com/support) and
\`unlimited\` exports. The Pro plan adds nothing else.

Cancel at any time.
`

/** What a located phrase actually covers in the Source. */
function anchored(source: string, selection: Parameters<typeof locatePhrase>[1]): string {
  const located = locatePhrase(source, selection)
  if (located.outcome === 'not-found') throw new Error('the phrase was not located')
  return source.slice(located.from, located.to)
}

describe('a phrase the reviewer selected in the Preview', () => {
  it('anchors to those characters, not to the block containing them', () => {
    expect(anchored(PROSE, inBlock(1, 'you can cancel at any time'))).toBe(
      'you can cancel at any time',
    )
    expect(locatePhrase(PROSE, inBlock(1, 'you can cancel at any time')).outcome).toBe('exact')
  })

  it('maps a phrase spanning bold, which the Source does not contain verbatim', () => {
    // The Preview renders `**billed monthly**` as `billed monthly`, so a phrase
    // running across the emphasis is nowhere in the Source as the reviewer read
    // it. The matcher's fuzzy path finds it anyway, and the Anchor covers the
    // Source characters, syntax included.
    const selection = inBlock(1, 'plan is billed monthly, and you')
    expect(PROSE).not.toContain('plan is billed monthly, and you')

    // `reworded` rather than `exact`, which is the honest answer: the window
    // the matcher settles on is close to the phrase rather than equal to it,
    // and the reviewer sees it selected on arrival and can narrow it.
    expect(locatePhrase(PROSE, selection).outcome).toBe('reworded')
    expect(anchored(PROSE, selection)).toContain('**billed monthly**')
  })

  it('maps a phrase spanning a link', () => {
    expect(anchored(PROSE, inBlock(2, 'priority support'))).toContain('priority support')
  })

  it('maps a phrase spanning inline code', () => {
    expect(anchored(PROSE, inBlock(2, 'unlimited exports'))).toContain('unlimited')
  })

  it('falls back to the containing block when the phrase repeats inside it', () => {
    // Two candidates in one paragraph is a coin toss. The reviewer lands on the
    // paragraph and narrows it, rather than on whichever one we guessed.
    const located = locatePhrase(PROSE, inBlock(2, 'The Pro plan adds'))
    expect(located.outcome).toBe('block')
    if (located.outcome === 'not-found') throw new Error('unreachable')
    expect(PROSE.slice(located.from, located.to)).toContain('unlimited')
  })

  it('spans from the start phrase in the first block to the end phrase in the last', () => {
    const located = locatePhrase(PROSE, {
      start: { block: 1, text: 'you can cancel' },
      end: { block: 2, text: 'priority support' },
    })
    if (located.outcome === 'not-found') throw new Error('unreachable')

    const anchor = PROSE.slice(located.from, located.to)
    expect(anchor.startsWith('you can cancel')).toBe(true)
    expect(anchor.endsWith('priority support')).toBe(true)
    // Everything between, including syntax that was never visible in the
    // Preview — the same as a selection made in the Source view.
    expect(anchor).toContain('The Pro plan adds [')
  })

  it('takes the whole span when a cross-block end cannot be pinned', () => {
    const located = locatePhrase(PROSE, {
      start: { block: 1, text: 'you can cancel' },
      end: { block: 2, text: 'The Pro plan adds' },
    })
    expect(located.outcome).toBe('block')
  })

  it('declines a selection that names no block of this Draft', () => {
    expect(locatePhrase(PROSE, inBlock(99, 'anything'))).toEqual({ outcome: 'not-found' })
  })

  it('declines a whitespace-only phrase rather than anchoring to a gap', () => {
    expect(locatePhrase(PROSE, inBlock(1, '   ')).outcome).toBe('block')
  })
})
