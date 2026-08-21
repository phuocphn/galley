import { describe, expect, it } from 'vitest'
import {
  blockAtOffset,
  locateBlock,
  locatePhrase,
  locateRenderedText,
  markdownBlocks,
  offsetOfBlock,
} from '../src/client/preview/mapping.js'

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

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <style>body { font-family: sans-serif }</style>
  </head>
  <body>
    <h2>Get started</h2>
    <p>Install the CLI, then point it at a folder of generated files.</p>
    <p>Every plan is <em>billed monthly</em>, and you can cancel at any time.</p>
    <h2>Get started</h2>
    <p>That heading appears twice on purpose.</p>
  </body>
</html>
`

/**
 * A passage as the frame would have reported it: the words the reviewer sees,
 * and the rendered text either side of them.
 *
 * Written out rather than rendered, because rendering it needs a DOM and this
 * needs none. What the frame reads off the page is its own business and is left
 * to the running app; what the Source is searched for is this.
 */
function read(text: string, before = '', after = '') {
  return { text, before, after }
}

/**
 * An HTML Draft has no blocks — sanitising and parsing keep no positions — so
 * both gestures come down to the same thing: find these rendered words in the
 * Source, or say that you could not. There is deliberately no block fallback
 * between those two answers; see `docs/adr/0005`.
 */
describe('a passage pointed at in an HTML Preview', () => {
  it('maps text that appears once in the Source to exactly those characters', () => {
    const located = locateRenderedText(
      PAGE,
      read('Install the CLI, then point it at a folder of generated files.'),
    )
    expect(located).toEqual({
      outcome: 'exact',
      from: PAGE.indexOf('Install the CLI'),
      to: PAGE.indexOf('generated files.') + 'generated files.'.length,
    })
  })

  it('maps a phrase whose rendered form differs from its Source form', () => {
    // The Preview renders `<em>billed monthly</em>` as `billed monthly`, so the
    // phrase the reviewer read is nowhere in the Source as they read it. The
    // matcher's fuzzy path finds it anyway, and the Anchor covers the Source
    // characters, tags included.
    const phrase = 'billed monthly, and you can cancel at any time'
    expect(PAGE).not.toContain(phrase)

    const located = locateRenderedText(PAGE, read(phrase))
    expect(located.outcome).toBe('reworded')
    if (located.outcome === 'not-found') throw new Error('unreachable')

    const anchor = PAGE.slice(located.from, located.to)
    expect(anchor).toContain('billed monthly')
    expect(anchor).toContain('</em>')
    expect(anchor).toContain('cancel at any time')
  })

  it('says the text could not be found rather than landing somewhere near it', () => {
    // No block to fall back to and nothing close enough to accept, so the
    // reviewer stays in the Preview where they were reading.
    expect(locateRenderedText(PAGE, read('This paragraph is nowhere in the page.'))).toEqual({
      outcome: 'not-found',
    })
  })

  it('refuses two candidates too close to call rather than guessing between them', () => {
    // "Get started" is in the page twice, and the rendered text either side of
    // it cannot separate them: the Source characters at the edge of a heading
    // are a tag, and the rendered ones never are. A coin toss would put the
    // Note on the wrong section with nothing to show for it.
    const located = locateRenderedText(
      PAGE,
      read(
        'Get started',
        'Every plan is billed monthly, and you can cancel at any time.\n    ',
        '\n    That heading appears twice on purpose.\n',
      ),
    )
    expect(located).toEqual({ outcome: 'not-found' })
  })

  it('tells two copies apart when the rendered text around them does agree', () => {
    // Where the repeats sit inside prose rather than inside their own tags, the
    // rendered neighbours are the Source's neighbours, and the second copy is
    // the one that was clicked rather than the first one that reads the same.
    const repeats = `<body>
  <p>Read the README. Get started. Then come back.</p>
  <p>Once the folder is open: Get started. It only takes a minute.</p>
</body>
`
    const second = repeats.indexOf('Get started', repeats.indexOf('Get started') + 1)

    expect(
      locateRenderedText(
        repeats,
        read('Get started', 'Once the folder is open: ', '. It only takes a minute.'),
      ),
    ).toEqual({ outcome: 'exact', from: second, to: second + 'Get started'.length })
  })

  it('declines a whitespace-only passage rather than anchoring to a gap', () => {
    expect(locateRenderedText(PAGE, read('   \n  '))).toEqual({ outcome: 'not-found' })
    expect(locateRenderedText(PAGE, read(''))).toEqual({ outcome: 'not-found' })
  })

  it('has nothing to offer for an empty Draft', () => {
    expect(locateRenderedText('', read('anything at all'))).toEqual({ outcome: 'not-found' })
  })
})

/**
 * The two lookups that keep the Source and the Preview on the same passage.
 *
 * They are each other's inverse, and that is the whole of what makes switching
 * views safe to do repeatedly: a reviewer who reads a paragraph, switches to
 * fix a word, and switches back must find the same paragraph rather than the
 * one below it, and then the one below that. Drift is the failure mode worth
 * testing for, because it is slow enough to look like nothing.
 */
describe('the passage the two views are both on', () => {
  it('resolves a block to an offset and back, for every block of a Draft', () => {
    const blocks = markdownBlocks(DRAFT)
    expect(blocks.length).toBeGreaterThan(1)

    for (let block = 0; block < blocks.length; block++) {
      const offset = offsetOfBlock(DRAFT, block)
      if (offset === null) throw new Error(`block ${block} has no offset`)
      expect(blockAtOffset(DRAFT, offset)).toBe(block)
    }
  })

  it('resolves every offset inside a block to that block', () => {
    // Not just the first character: the reviewer scrolls to wherever they
    // scroll to, and a long paragraph is many screens of offsets that are all
    // the same passage.
    markdownBlocks(DRAFT).forEach((block, index) => {
      for (let offset = block.from; offset < block.to; offset++) {
        expect(blockAtOffset(DRAFT, offset)).toBe(index)
      }
    })
  })

  it('settles rather than drifting when the views are switched over and over', () => {
    // A switch there and back is a lookup and its inverse, so the offset it
    // lands on is the offset it started from — however many times it is done.
    let offset = offsetOfBlock(DRAFT, 3)
    if (offset === null) throw new Error('unreachable')

    for (let cycle = 0; cycle < 5; cycle++) {
      const block = blockAtOffset(DRAFT, offset)
      if (block === null) throw new Error('unreachable')
      const next = offsetOfBlock(DRAFT, block)
      if (next === null) throw new Error('unreachable')
      expect(next).toBe(offset)
      offset = next
    }
  })

  it('resolves the gap between two blocks to the block that starts next', () => {
    // The blank line under a heading belongs to no block. A view whose top edge
    // sits in it has the paragraph below filling the screen, not the heading
    // that has just gone off the top.
    const [heading, paragraph] = markdownBlocks(DRAFT)
    if (!heading || !paragraph) throw new Error('unreachable')
    expect(paragraph.from).toBeGreaterThan(heading.to)

    for (let offset = heading.to; offset < paragraph.from; offset++) {
      expect(blockAtOffset(DRAFT, offset)).toBe(1)
    }
  })

  it('resolves an offset before the first block to it', () => {
    const padded = `\n\n${DRAFT}`
    expect(blockAtOffset(padded, 0)).toBe(0)
    expect(offsetOfBlock(padded, 0)).toBe(2)
  })

  it('holds the last block for an offset past the end of the Draft', () => {
    // The trailing newlines of a Draft are still its end, and a reviewer who
    // scrolled to the bottom of one view expects the bottom of the other.
    const last = markdownBlocks(DRAFT).length - 1
    expect(blockAtOffset(DRAFT, DRAFT.length)).toBe(last)
    expect(blockAtOffset(DRAFT, DRAFT.length + 1_000)).toBe(last)
  })

  it('has no passage to offer for a Draft with no blocks in it', () => {
    expect(blockAtOffset('', 0)).toBeNull()
    expect(blockAtOffset('\n\n   \n', 2)).toBeNull()
    expect(offsetOfBlock('', 0)).toBeNull()
  })

  it('declines a block the Draft does not have', () => {
    expect(offsetOfBlock(DRAFT, 99)).toBeNull()
    expect(offsetOfBlock(DRAFT, -1)).toBeNull()
  })
})
