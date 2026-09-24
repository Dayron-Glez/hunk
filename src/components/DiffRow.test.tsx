import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DiffLine } from '../core/parse/types'
import { DiffRow } from './DiffRow'

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
      insert: 'bg-emerald-500/10',
      delete: 'bg-rose-500/10',
    }[kind]
    expect(backgroundsOn(tinted!)).toEqual([expected])
  })

  it('keeps the numbers out of a copied selection', () => {
    const { container } = render(<DiffRow line={lineOf('context')} segments={null} />)
    expect(gutterOf(container).querySelector('.select-none')).not.toBeNull()
  })
})
