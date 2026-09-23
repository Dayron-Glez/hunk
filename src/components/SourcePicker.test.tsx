import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourcePicker } from './SourcePicker'

const field = (): HTMLElement => screen.getByLabelText('Paste a pull request link')
const open = (): HTMLElement => screen.getByRole('button', { name: /^Read/ })

const type = (text: string): void => {
  fireEvent.change(field(), { target: { value: text } })
}

/** The network stands still until the test lets it move. */
function heldFetch(): {
  readonly fetch: typeof fetch
  readonly settle: (response: Response) => void
  readonly calls: string[]
} {
  const calls: string[] = []
  let release: (response: Response) => void = () => undefined
  const impl = ((url: string) => {
    calls.push(String(url))
    return new Promise<Response>((resolve) => {
      release = resolve
    })
  }) as unknown as typeof fetch
  return {
    fetch: impl,
    settle: (response) => {
      release(response)
    },
    calls,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('opening a pull request by link', () => {
  it('asks GitHub for the diff and hands it up', async () => {
    const held = heldFetch()
    vi.stubGlobal('fetch', held.fetch)
    const onLoad = vi.fn()
    render(<SourcePicker onLoad={onLoad} />)

    type('https://github.com/vitejs/vite/pull/23346/files')
    fireEvent.click(open())

    expect(held.calls).toEqual(['https://api.github.com/repos/vitejs/vite/pulls/23346'])
    held.settle(new Response('diff --git a/x b/x\n', { status: 200 }))
    await waitFor(() => {
      expect(onLoad).toHaveBeenCalledOnce()
    })
    // With where the rest of its files live, which is what lets the reader
    // open the unchanged lines the diff left out.
    expect(onLoad).toHaveBeenCalledWith('diff --git a/x b/x\n', {
      owner: 'vitejs',
      repo: 'vite',
      ref: 'refs/pull/23346/head',
    })
  })

  it('says it is working, and refuses a second press meanwhile', () => {
    const held = heldFetch()
    vi.stubGlobal('fetch', held.fetch)
    render(<SourcePicker onLoad={vi.fn()} />)

    type('vitejs/vite#23346')
    fireEvent.click(open())

    expect(open()).toHaveTextContent('Reading…')
    expect(open()).toBeDisabled()
    fireEvent.click(open())
    expect(held.calls).toHaveLength(1)
  })

  it('costs no request for something that is not a link', () => {
    const held = heldFetch()
    vi.stubGlobal('fetch', held.fetch)
    render(<SourcePicker onLoad={vi.fn()} />)

    type('have a look at my pull request')
    fireEvent.click(open())

    // Sixty an hour is little enough to spend none of it on a typo.
    expect(held.calls).toHaveLength(0)
    expect(screen.getByRole('alert')).toHaveTextContent('does not look like a pull request link')
  })

  it('will not submit an empty field', () => {
    render(<SourcePicker onLoad={vi.fn()} />)
    expect(open()).toBeDisabled()
  })

  it('tells the reader what went wrong, in that failure’s own words', async () => {
    const held = heldFetch()
    vi.stubGlobal('fetch', held.fetch)
    render(<SourcePicker onLoad={vi.fn()} />)

    type('github.com/vitejs/vite/pull/23346')
    fireEvent.click(open())
    held.settle(new Response('{"message":"Not Found"}', { status: 404 }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('No pull request vitejs/vite#23346')
    })
    expect(screen.getByRole('alert')).toHaveTextContent('private repository')
  })

  it('points a screen reader at the message, and marks the field', async () => {
    const held = heldFetch()
    vi.stubGlobal('fetch', held.fetch)
    render(<SourcePicker onLoad={vi.fn()} />)

    // Before anything fails, the field is described by the rate-limit note.
    expect(field()).toHaveAttribute('aria-invalid', 'false')
    const note = field().getAttribute('aria-describedby')!
    expect(document.getElementById(note)).toHaveTextContent('sixty requests an hour')

    type('github.com/vitejs/vite/pull/1')
    fireEvent.click(open())
    held.settle(new Response('', { status: 406 }))

    await waitFor(() => {
      expect(field()).toHaveAttribute('aria-invalid', 'true')
    })
    const described = field().getAttribute('aria-describedby')!
    expect(document.getElementById(described)).toHaveAttribute('role', 'alert')
  })

  it('clears the complaint as soon as the reader edits the field', async () => {
    const held = heldFetch()
    vi.stubGlobal('fetch', held.fetch)
    render(<SourcePicker onLoad={vi.fn()} />)

    type('nonsense')
    fireEvent.click(open())
    expect(screen.getByRole('alert')).toBeInTheDocument()

    type('github.com/vitejs/vite/pull/1')
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  it('says up front what it cannot reach, before anyone tries', () => {
    render(<SourcePicker onLoad={vi.fn()} />)
    const note = screen.getByText(/sixty requests an hour/)
    expect(note).toHaveTextContent('Public repositories only')
  })
})

describe('the other ways in still work', () => {
  it('renders a pasted diff', () => {
    const onLoad = vi.fn()
    render(<SourcePicker onLoad={onLoad} />)

    fireEvent.change(screen.getByLabelText('…or paste a diff'), {
      target: { value: 'diff --git a/a b/a\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Render it' }))
    // No origin: a pasted diff says nothing about where its files could be
    // found, so there is nothing to offer to expand.
    expect(onLoad).toHaveBeenCalledWith('diff --git a/a b/a\n', null)
  })

  it('offers the real diffs it ships with', () => {
    render(<SourcePicker onLoad={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Linux kernel commit/ })).toBeInTheDocument()
  })
})
