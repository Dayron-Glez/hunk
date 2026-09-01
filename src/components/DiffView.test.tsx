import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readFixture } from '../../tests/fixtures'
import { parseUnifiedDiff } from '../core/parse/unified'
import { DiffView } from './DiffView'

const renderFixture = (set: 'edge' | 'github', name: string): void => {
  render(<DiffView diff={parseUnifiedDiff(readFixture(set, name))} />)
}

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
    renderFixture('github', 'git-4125f782-submodule-bump.diff')
    expect(screen.getByText(/Subproject commit 855827c583bc30/)).toBeInTheDocument()
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
