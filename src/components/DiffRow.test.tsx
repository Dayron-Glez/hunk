import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DiffLine } from '../core/parse/types'
import { DiffRow, SplitDiffRow } from './DiffRow'

const lineOf = (kind: DiffLine['kind']): DiffLine => ({
  kind,
  content: 'const x = 1',
  oldNumber: kind === 'insert' ? null : 12,
  newNumber: kind === 'delete' ? null : 12,
  noNewlineAtEof: false,
})

const KINDS: DiffLine['kind'][] = ['context', 'insert', 'delete']

const gutterOf = (container: HTMLElement): HTMLElement => {
  const gutter = container.querySelector<HTMLElement>('.sticky')
  if (gutter === null) throw new Error('no sticky gutter')
  return gutter
}

const backgroundsOn = (element: Element): string[] =>
  String(element.className)
    .split(' ')
    .filter((name) => name.startsWith('bg-'))

/**
 * A sticky gutter overlaps whatever scrolls under it, so it has to be opaque
 * or the line slides into view behind the numbers — which is exactly what a
 * reader saw on a real diff.
 *
 * It was one element carrying both `bg-neutral-950` and the row's tint, and
 * which of the two applied was decided by the order Tailwind emitted them
 * in, not by the order they were written. Measured in a browser it came out
 * transparent on a context line, the tint alone on a removal, and the base
 * alone on an insertion: two that let the code through, one that lost its
 * colour. So the rule is one background per element, and a test that says so
 * rather than a comment hoping someone reads it.
 */
describe('the line-number gutter', () => {
  it('stays put while the line scrolls', () => {
    const { container } = render(<DiffRow line={lineOf('context')} segments={null} />)
    const gutter = gutterOf(container)
    expect(gutter.className).toContain('sticky')
    expect(gutter.className).toContain('left-0')
  })

  it.each(KINDS)('carries exactly one background on each element, for a %s line', (kind) => {
    const { container } = render(<DiffRow line={lineOf(kind)} segments={null} />)
    for (const element of container.querySelectorAll('*')) {
      expect(backgroundsOn(element).length).toBeLessThanOrEqual(1)
    }
  })

  it.each(KINDS)('is opaque underneath, for a %s line', (kind) => {
    const { container } = render(<DiffRow line={lineOf(kind)} segments={null} />)
    const gutter = gutterOf(container)
    expect(backgroundsOn(gutter)).toEqual(['bg-neutral-950'])
  })

  /** The base cannot swallow the tint either: a removal's gutter is rose
   *  like the rest of its row, not a neutral notch cut out of it. */
  it.each(KINDS)('still shows the row tint above that base, for a %s line', (kind) => {
    const { container } = render(<DiffRow line={lineOf(kind)} segments={null} />)
    const tinted = gutterOf(container).firstElementChild
    expect(tinted).not.toBeNull()
    const expected = {
      context: 'bg-transparent',
      insert: 'bg-diff-added',
      delete: 'bg-diff-removed',
    }[kind]
    expect(backgroundsOn(tinted!)).toEqual([expected])
  })

  /** The bar is the loud part of a changed line — the tint is held down by
   *  the code that has to stay readable on it — so it belongs where the
   *  numbers are, which is the one place that survives a long line being
   *  scrolled sideways. */
  it.each(KINDS)('carries the edge bar on the sticky side, for a %s line', (kind) => {
    const { container } = render(<DiffRow line={lineOf(kind)} segments={null} />)
    const tinted = gutterOf(container).firstElementChild
    expect(tinted).not.toBeNull()
    const expected = {
      context: 'border-l-transparent',
      insert: 'border-l-diff-added-ink',
      delete: 'border-l-diff-removed-ink',
    }[kind]
    expect(String(tinted!.className).split(' ')).toContain(expected)
  })

  /**
   * Two columns meant one of them was blank on every line that had changed,
   * with nothing to say which was which. The one that remains names the line
   * as it stands after the change, falling back to what it was before on a
   * line that no longer exists after — the same number `spokenLabel` reads
   * out, so the gutter and the screen reader agree.
   */
  describe('showing one number per line', () => {
    const numbersOn = (kind: DiffLine['kind']): string[] => {
      const { container } = render(<DiffRow line={lineOf(kind)} segments={null} />)
      return [...gutterOf(container).querySelectorAll('.tabular-nums')].map((span) =>
        (span.textContent ?? '').trim(),
      )
    }

    it.each(KINDS)('shows exactly one, for a %s line', (kind) => {
      expect(numbersOn(kind)).toHaveLength(1)
    })

    it('shows the number a line has after the change', () => {
      const line: DiffLine = { ...lineOf('insert'), oldNumber: null, newNumber: 42 }
      const { container } = render(<DiffRow line={line} segments={null} />)
      expect(gutterOf(container).querySelector('.tabular-nums')?.textContent).toBe('42')
    })

    it('falls back to the number a removed line had before it', () => {
      const line: DiffLine = { ...lineOf('delete'), oldNumber: 7, newNumber: null }
      const { container } = render(<DiffRow line={line} segments={null} />)
      expect(gutterOf(container).querySelector('.tabular-nums')?.textContent).toBe('7')
    })
  })

  it('keeps the numbers out of a copied selection', () => {
    const { container } = render(<DiffRow line={lineOf('context')} segments={null} />)
    expect(gutterOf(container).querySelector('.select-none')).not.toBeNull()
  })
})

/**
 * The edge bar names its side. The divider between the columns used to be a
 * `border-neutral-800` on the same element, and the shorthand writes every
 * side: it repainted the bar, and which of the two won came down to the order
 * Tailwind emitted them in — the removal's bar went grey on the left while
 * the addition's stayed green on the right, where there was no divider. The
 * divider has since moved out of the rows altogether, but the rule it broke
 * is the one that matters here, and it is the same rule as one background per
 * element.
 */
describe('the split row', () => {
  const removal: DiffLine = { ...lineOf('delete') }
  const addition: DiffLine = { ...lineOf('insert') }

  it('keeps the edge bar on both columns, in their own colours', () => {
    const { container } = render(
      <SplitDiffRow oldLine={removal} newLine={addition} oldSegments={null} newSegments={null} />,
    )
    const [before, after] = container.querySelectorAll('[role="gridcell"]')
    const classesOf = (element: Element): string[] => String(element.className).split(' ')

    expect(classesOf(before!)).toContain('border-l-diff-removed-ink')
    expect(classesOf(after!)).toContain('border-l-diff-added-ink')
    // Nothing on a cell may write border-color for every side at once.
    for (const cell of [before!, after!]) {
      expect(
        classesOf(cell).filter((name) => /^border-(?!l-|r-|t-|b-|x-|y-)\S*[a-z]/.test(name)),
      ).toEqual([])
    }
  })
})
