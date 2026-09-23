import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from './ui/sonner'
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

/**
 * Swapping "Read it" for "Reading…" made the button wider, and the field
 * beside it narrower, in the middle of a request — moving the text the reader
 * had just typed. Both labels now share a grid cell, so the button is always
 * as wide as the longer one.
 */
describe('the button keeps its size while it works', () => {
  const submit = (): HTMLElement => screen.getByRole('button', { name: /^(Read it|Reading…)$/ })

  const labels = (): { text: string; hidden: string | null }[] =>
    Array.from(submit().querySelectorAll('span > span')).map((el) => ({
      text: (el.textContent ?? '').trim(),
      hidden: el.getAttribute('aria-hidden'),
    }))

  it('carries both labels, with only one of them alive', () => {
    const held = heldFetch()
    vi.stubGlobal('fetch', held.fetch)
    render(<SourcePicker onLoad={vi.fn()} />)

    expect(labels()).toEqual([
      { text: 'Read it', hidden: 'false' },
      { text: 'Reading…', hidden: 'true' },
    ])

    type('vitejs/vite#23346')
    fireEvent.click(submit())

    expect(labels()).toEqual([
      { text: 'Read it', hidden: 'true' },
      { text: 'Reading…', hidden: 'false' },
    ])
  })

  it('reads as one label at a time, not both at once', () => {
    const held = heldFetch()
    vi.stubGlobal('fetch', held.fetch)
    render(<SourcePicker onLoad={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Read it' })).toBeInTheDocument()
    type('vitejs/vite#23346')
    fireEvent.click(submit())
    expect(screen.getByRole('button', { name: 'Reading…' })).toBeInTheDocument()
  })

  /** The README says what moves in this application; a spinner that ignored
   *  the request for less of it would make that untrue. */
  it('only spins where motion is welcome', () => {
    const held = heldFetch()
    vi.stubGlobal('fetch', held.fetch)
    render(<SourcePicker onLoad={vi.fn()} />)

    type('vitejs/vite#23346')
    fireEvent.click(submit())

    const spinner = submit().querySelector('svg')!
    expect(spinner.getAttribute('class')).toContain('motion-safe:animate-spin')
  })
})

/**
 * Dropping was the only way in. A reader who would rather pick a file had
 * nothing to press, and one on a keyboard had nothing at all — there is no
 * dragging without a pointer.
 */
describe('choosing a file as well as dropping one', () => {
  const field = (): HTMLInputElement => screen.getByLabelText(/Drop a .diff or .patch here/)

  const DIFF = ['diff --git a/a b/a', '--- a/a', '+++ b/a', '@@ -1 +1 @@', '-old', '+new', ''].join(
    String.fromCharCode(10),
  )

  const fileOf = (text: string, name = 'change.diff'): File =>
    new File([text], name, { type: 'text/plain' })

  it('offers a real file input, reachable by keyboard', () => {
    render(<SourcePicker onLoad={vi.fn()} />)

    const input = field()
    expect(input.type).toBe('file')
    // Out of sight, not out of the tab order: the label shows the ring.
    expect(input.className).toContain('sr-only')
    expect(input).not.toHaveAttribute('tabindex', '-1')
  })

  it('says a file can be chosen, not only dropped', () => {
    render(<SourcePicker onLoad={vi.fn()} />)
    expect(screen.getByText('or choose a file')).toBeInTheDocument()
  })

  it('reads the file that was chosen', async () => {
    const onLoad = vi.fn()
    render(<SourcePicker onLoad={onLoad} />)

    fireEvent.change(field(), { target: { files: [fileOf(DIFF)] } })
    await waitFor(() => {
      expect(onLoad).toHaveBeenCalledWith(DIFF, null)
    })
  })

  it('still reads one that was dropped', async () => {
    const onLoad = vi.fn()
    render(<SourcePicker onLoad={onLoad} />)

    const zone = field().closest('label')!
    fireEvent.drop(zone, { dataTransfer: { files: [fileOf(DIFF)] } })
    await waitFor(() => {
      expect(onLoad).toHaveBeenCalledWith(DIFF, null)
    })
  })

  it('takes the same file twice in a row', async () => {
    const onLoad = vi.fn()
    render(<SourcePicker onLoad={onLoad} />)

    // The input is cleared after each read, or the second choice of the same
    // file fires no change event at all.
    fireEvent.change(field(), { target: { files: [fileOf(DIFF)] } })
    await waitFor(() => {
      expect(onLoad).toHaveBeenCalledOnce()
    })
    expect(field().value).toBe('')
  })

  it('asks the picker for the kinds it can read', () => {
    render(<SourcePicker onLoad={vi.fn()} />)
    expect(field().accept).toContain('.diff')
    expect(field().accept).toContain('.patch')
  })

  /** The input is out of sight, so the ring has to be drawn by the label
   *  around it or a keyboard reader has nothing to see. */
  it('shows a focus ring on the zone, since the input itself is hidden', () => {
    render(<SourcePicker onLoad={vi.fn()} />)
    const zone = field().closest('label')!
    expect(zone.className).toContain('focus-within:outline-2')
    expect(zone.className).toContain('focus-within:outline-sky-400')
  })
})

/**
 * Before this, dropping a picture rendered an empty diff and the viewer said
 * "nothing to show" — true, and no help at all.
 */
describe('saying whether the file could be read', () => {
  const field = (): HTMLInputElement => screen.getByLabelText(/Drop a .diff or .patch here/)

  const drop = (text: string, name: string): void => {
    fireEvent.change(field(), {
      target: { files: [new File([text], name, { type: 'text/plain' })] },
    })
  }

  const DIFF = ['diff --git a/a b/a', '--- a/a', '+++ b/a', '@@ -1 +1 @@', '-old', '+new', ''].join(
    String.fromCharCode(10),
  )

  const show = (onLoad = vi.fn()) =>
    render(
      <>
        <Toaster />
        <SourcePicker onLoad={onLoad} />
      </>,
    )

  it('says so when one loads, and how much is in it', async () => {
    show()
    drop(DIFF, 'change.diff')
    expect(await screen.findByText(/change\.diff — 1 file changed\./)).toBeInTheDocument()
  })

  it('refuses a picture and says it is not text', async () => {
    const onLoad = vi.fn()
    show(onLoad)

    drop(String.fromCharCode(137) + 'PNG' + String.fromCharCode(0), 'shot.png')
    expect(await screen.findByText(/shot\.png is not text/)).toBeInTheDocument()
    expect(onLoad).not.toHaveBeenCalled()
  })

  it('refuses a file with no diff in it, and says what one looks like', async () => {
    const onLoad = vi.fn()
    show(onLoad)

    drop('# Just a readme', 'README.md')
    expect(await screen.findByText(/README\.md has no diff in it/)).toBeInTheDocument()
    expect(onLoad).not.toHaveBeenCalled()
  })

  it('refuses something enormous without reading it', async () => {
    const onLoad = vi.fn()
    show(onLoad)

    const huge = new File(['x'], 'holiday.mp4', { type: 'video/mp4' })
    Object.defineProperty(huge, 'size', { value: 700 * 1024 * 1024 })
    fireEvent.change(field(), { target: { files: [huge] } })

    expect(await screen.findByText(/holiday\.mp4 is 700\.0 MB/)).toBeInTheDocument()
    expect(onLoad).not.toHaveBeenCalled()
  })
})
