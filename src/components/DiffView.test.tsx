import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFixture } from '../../tests/fixtures'
import { parseUnifiedDiff } from '../core/parse/unified'
import { DiffView } from './DiffView'

const renderFixture = (set: 'edge' | 'github', name: string) =>
  render(<DiffView diff={parseUnifiedDiff(readFixture(set, name))} />)

// The tests below are about what the viewer says, not about what it leaves out,
// so they are given a viewport tall enough to hold the whole fixture. The
// windowing itself is exercised separately, with a small one.
beforeEach(() => {
  globalThis.testViewportHeight = 100_000
})
afterEach(() => {
  globalThis.testViewportHeight = 800
})

describe('DiffView', () => {
  it('heads each file with its path and its line counts', () => {
    renderFixture('github', 'vite-pr-23346-normal.diff')
    const heading = screen.getByRole('heading', { name: 'packages/vite/src/node/utils.ts' })
    const header = heading.parentElement!
    expect(within(header).getByText('+1')).toBeInTheDocument()
    expect(within(header).getByText('-1')).toBeInTheDocument()
  })

  it('shows the totals for the whole diff', () => {
    renderFixture('github', 'vite-pr-23346-normal.diff')
    const totals = screen.getByText('2 files').parentElement!
    expect(within(totals).getByText('+21')).toBeInTheDocument()
    expect(within(totals).getByText('-1')).toBeInTheDocument()
  })

  it('renders added, removed and unchanged lines', () => {
    renderFixture('edge', 'mode-change-with-content.diff')
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('bravo')).toBeInTheDocument()
    expect(screen.getByText('BRAVO')).toBeInTheDocument()
    expect(screen.getByText('charlie')).toBeInTheDocument()
  })

  it('says a file is binary instead of leaving it blank', () => {
    renderFixture('github', 'github-docs-5dc99214-binary-delete.diff')
    expect(screen.getByText('Binary file, not shown.')).toBeInTheDocument()
  })

  it('says when only the mode changed', () => {
    renderFixture('edge', 'mode-change-only.diff')
    expect(screen.getByText('Only the file mode changed.')).toBeInTheDocument()
    expect(screen.getByText('100644 → 100755')).toBeInTheDocument()
  })

  it('shows a rename as one path becoming another', () => {
    renderFixture('github', 'prettier-bb52ae36-rename.diff')
    expect(
      screen.getByRole('heading', {
        name: 'tests/format/js/label/empty_label.js → tests/format/js/label/empty-label.js',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('Moved with no content change.')).toBeInTheDocument()
  })

  it('names a submodule change rather than showing an empty file', () => {
    const { container } = renderFixture('github', 'git-4125f782-submodule-bump.diff')
    // Read the rendered text rather than one node: intra-line highlighting
    // splits a line wherever part of it changed, which is the point of it.
    expect(container.textContent).toContain('Subproject commit 855827c583bc30')
  })

  it('flags the no-newline marker on the line it belongs to', () => {
    renderFixture('edge', 'no-newline-added.diff')
    expect(screen.getByText('no newline at end of file')).toBeInTheDocument()
  })

  it('says a diff is empty rather than rendering nothing at all', () => {
    renderFixture('edge', 'empty.diff')
    expect(screen.getByText('Nothing to show — this diff is empty.')).toBeInTheDocument()
  })

  it('surfaces parser warnings instead of hiding them', () => {
    render(
      <DiffView
        diff={parseUnifiedDiff(
          ['diff --cc merged.txt', '@@@ -1,1 -1,1 +1,1 @@@', '  same', ''].join('\n'),
        )}
      />,
    )
    expect(screen.getByText(/combined \(merge\) diffs are not supported/)).toBeInTheDocument()
    expect(screen.getByText('Combined diff from a merge — not supported yet.')).toBeInTheDocument()
  })
})

describe('choosing a layout', () => {
  it('starts unified, with one line per row', () => {
    renderFixture('edge', 'mode-change-with-content.diff')
    expect(screen.getByRole('button', { name: 'Unified' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('puts the two versions of an edited line on one row when asked to', () => {
    renderFixture('edge', 'mode-change-with-content.diff')
    fireEvent.click(screen.getByRole('button', { name: 'Split' }))

    const rows = Array.from(
      screen.getByTestId('diff-scroller').querySelector('[data-rows]')!.children,
    ) as HTMLElement[]
    const paired = rows.find((row) => row.children[0]?.textContent?.includes('bravo') === true)
    expect(paired?.children[1]?.textContent).toContain('BRAVO')
  })

  it('goes back to one column', () => {
    renderFixture('edge', 'mode-change-with-content.diff')
    fireEvent.click(screen.getByRole('button', { name: 'Split' }))
    fireEvent.click(screen.getByRole('button', { name: 'Unified' }))
    expect(screen.getByRole('button', { name: 'Unified' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('alpha')).toBeInTheDocument()
  })
})
