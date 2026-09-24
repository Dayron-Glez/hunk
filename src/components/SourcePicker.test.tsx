import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from './ui/sonner'
import { SourcePicker } from './SourcePicker'

const field = (): HTMLElement => screen.getByLabelText('Paste a pull request link')
/** Specific: the token panel's own button also begins with "Read". */
const open = (): HTMLElement => screen.getByRole('button', { name: /^(Read it|Reading)/ })

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
    render(<SourcePicker onLoad={onLoad} onTokenChange={() => undefined} />)

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
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)

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
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)

    type('have a look at my pull request')
    fireEvent.click(open())

    // Sixty an hour is little enough to spend none of it on a typo.
    expect(held.calls).toHaveLength(0)
    expect(screen.getByRole('alert')).toHaveTextContent('does not look like a pull request link')
  })

  it('will not submit an empty field', () => {
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)
    expect(open()).toBeDisabled()
  })

  it('tells the reader what went wrong, in that failure’s own words', async () => {
    const held = heldFetch()
    vi.stubGlobal('fetch', held.fetch)
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)

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
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)

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
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)

    type('nonsense')
    fireEvent.click(open())
    expect(screen.getByRole('alert')).toBeInTheDocument()

    type('github.com/vitejs/vite/pull/1')
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  it('says up front what it cannot reach, before anyone tries', () => {
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)
    const note = screen.getByText(/sixty requests an hour/)
    expect(note).toHaveTextContent('Public repositories only')
  })
})

describe('the other ways in still work', () => {
  it('renders a pasted diff', () => {
    const onLoad = vi.fn()
    render(<SourcePicker onLoad={onLoad} onTokenChange={() => undefined} />)

    fireEvent.change(screen.getByLabelText('…or paste a diff'), {
      target: { value: 'diff --git a/a b/a\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Render it' }))
    // No origin: a pasted diff says nothing about where its files could be
    // found, so there is nothing to offer to expand.
    expect(onLoad).toHaveBeenCalledWith('diff --git a/a b/a\n', null)
  })

  it('offers the real diffs it ships with', () => {
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)
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
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)

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
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)

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
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)

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
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)

    const input = field()
    expect(input.type).toBe('file')
    // Out of sight, not out of the tab order: the label shows the ring.
    expect(input.className).toContain('sr-only')
    expect(input).not.toHaveAttribute('tabindex', '-1')
  })

  it('says a file can be chosen, not only dropped', () => {
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)
    expect(screen.getByText('or choose a file')).toBeInTheDocument()
  })

  it('reads the file that was chosen', async () => {
    const onLoad = vi.fn()
    render(<SourcePicker onLoad={onLoad} onTokenChange={() => undefined} />)

    fireEvent.change(field(), { target: { files: [fileOf(DIFF)] } })
    await waitFor(() => {
      expect(onLoad).toHaveBeenCalledWith(DIFF, null)
    })
  })

  it('still reads one that was dropped', async () => {
    const onLoad = vi.fn()
    render(<SourcePicker onLoad={onLoad} onTokenChange={() => undefined} />)

    const zone = field().closest('label')!
    fireEvent.drop(zone, { dataTransfer: { files: [fileOf(DIFF)] } })
    await waitFor(() => {
      expect(onLoad).toHaveBeenCalledWith(DIFF, null)
    })
  })

  it('takes the same file twice in a row', async () => {
    const onLoad = vi.fn()
    render(<SourcePicker onLoad={onLoad} onTokenChange={() => undefined} />)

    // The input is cleared after each read, or the second choice of the same
    // file fires no change event at all.
    fireEvent.change(field(), { target: { files: [fileOf(DIFF)] } })
    await waitFor(() => {
      expect(onLoad).toHaveBeenCalledOnce()
    })
    expect(field().value).toBe('')
  })

  it('asks the picker for the kinds it can read', () => {
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)
    expect(field().accept).toContain('.diff')
    expect(field().accept).toContain('.patch')
  })

  /**
   * The input is out of sight, so the ring has to be drawn by the label
   * around it or a keyboard reader has nothing to see.
   *
   * Drawn with the theme's own ring rather than a colour of its own: this is
   * a control like any other, and it used to carry a hand-written sky ring
   * that would drift the moment the accent changed — which it then did.
   */
  it('shows a focus ring on the zone, since the input itself is hidden', () => {
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)
    const zone = field().closest('label')!
    expect(zone.className).toContain('focus-within:ring-3')
    expect(zone.className).toContain('focus-within:ring-ring/50')
    expect(zone.className).toContain('focus-within:border-ring')
  })

  it('draws that ring the same way a button does', () => {
    const { container } = render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)
    const zone = field().closest('label')!
    const button = container.querySelector('button')!
    for (const part of ['ring-3', 'ring-ring/50', 'border-ring']) {
      expect(zone.className).toContain(part)
      expect(button.className).toContain(part)
    }
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
        <SourcePicker onLoad={onLoad} onTokenChange={() => undefined} />
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

/**
 * The token belongs to the reader, and the only place it is allowed to go is
 * the Authorization header of a request to api.github.com. Not the path, not
 * the query, and not the screen.
 */
describe('a pull request read with a token', () => {
  const spying = (): {
    fetch: typeof fetch
    urls: string[]
    inits: (RequestInit | undefined)[]
  } => {
    const urls: string[] = []
    const inits: (RequestInit | undefined)[] = []
    return {
      urls,
      inits,
      fetch: ((url: string, init?: RequestInit) => {
        urls.push(String(url))
        inits.push(init)
        return new Promise<Response>(() => undefined)
      }) as unknown as typeof fetch,
    }
  }

  it('sends it as a header, and puts it in no URL', () => {
    const spy = spying()
    vi.stubGlobal('fetch', spy.fetch)
    render(
      <SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} token="github_pat_secret" />,
    )

    type('github.com/vitejs/vite/pull/23346')
    fireEvent.click(open())

    expect((spy.inits[0]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer github_pat_secret',
    )
    for (const url of spy.urls) expect(url).not.toContain('github_pat_secret')
  })

  it('shows the ceiling the token buys, not the anonymous one', () => {
    render(
      <SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} token="github_pat_secret" />,
    )
    expect(screen.getByText(/Through GitHub.s API, with your token/)).toHaveTextContent(
      'five thousand requests an hour',
    )
    expect(screen.queryByText(/sixty requests an hour/)).not.toBeInTheDocument()
  })

  it('shows the anonymous ceiling without one', () => {
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)
    expect(screen.getByText(/sixty requests an hour/)).toBeInTheDocument()
  })

  it('never renders the token itself', () => {
    render(
      <SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} token="github_pat_secret" />,
    )
    expect(document.body.textContent).not.toContain('github_pat_secret')
  })
})

/**
 * Found in a browser, not by these tests: the token field was first written
 * inside the pull request form. A form inside a form is not a thing HTML
 * has — React refuses it, the submit handler never runs, and pressing Enter
 * reloads the page. Every unit test passed, because they mounted the field
 * on its own, which is the one arrangement where the bug cannot happen.
 */
describe('the token field beside the pull request field', () => {
  const askForToken = (): void => {
    fireEvent.click(screen.getByRole('button', { name: /Read a private repository/ }))
  }

  it('is not inside the pull request form', () => {
    const { container } = render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)
    askForToken()
    for (const form of container.querySelectorAll('form')) {
      expect(form.querySelector('form')).toBeNull()
    }
  })

  it('checks the token instead of reloading the page', async () => {
    const asked: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        asked.push(String(url))
        return Promise.resolve(new Response('{}', { status: 401 }))
      }),
    )
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)
    askForToken()

    fireEvent.change(screen.getByLabelText(/personal access token/), {
      target: { value: 'github_pat_x' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Check and keep/ }))

    await waitFor(() => {
      expect(asked).toEqual(['https://api.github.com/rate_limit'])
    })
  })

  /** The pull request field is untouched by any of it. */
  it('does not ask for a diff when the token is submitted', async () => {
    const asked: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        asked.push(String(url))
        return Promise.resolve(new Response('{}', { status: 401 }))
      }),
    )
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)
    type('github.com/vitejs/vite/pull/23346')
    askForToken()

    fireEvent.change(screen.getByLabelText(/personal access token/), {
      target: { value: 'github_pat_x' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Check and keep/ }))

    await waitFor(() => {
      expect(asked.length).toBe(1)
    })
    expect(asked[0]).not.toContain('/pulls/')
  })
})

/**
 * Found while testing against a real private pull request. The anonymous
 * attempt failed with a 404, the reader then added a token, and the failure
 * still on screen quietly rewrote itself into "or your token does not cover
 * that repository" — a claim about a token that was not used for it. The
 * sentence was right for the state and wrong about the request.
 */
describe('a failure from before the token', () => {
  const failing = (): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{"message":"Not Found"}', { status: 404 }))),
    )
  }

  it('does not survive a token being added', async () => {
    failing()
    const { rerender } = render(
      <SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} token={null} />,
    )
    type('github.com/owner/private/pull/1')
    fireEvent.click(open())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('private repository')
    })

    rerender(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} token="github_pat_x" />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not survive a token being forgotten either', async () => {
    failing()
    const { rerender } = render(
      <SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} token="github_pat_x" />,
    )
    type('github.com/owner/private/pull/1')
    fireEvent.click(open())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('token does not cover')
    })

    rerender(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} token={null} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

/**
 * The instructions were behind a quiet grey button, which for a reader who
 * does not already know tokens exist is the same as not having them. The
 * two answers a token is the response to now open it themselves, at the
 * moment the reader has been told what the problem is.
 */
describe('finding the token panel', () => {
  const answering = (status: number, body = '{}'): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(body, { status }))),
    )
  }

  const steps = (): HTMLElement | null => screen.queryByLabelText(/personal access token/)

  it('is shut on a page nobody has failed on yet', () => {
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)
    expect(steps()).not.toBeInTheDocument()
  })

  it('opens itself when a pull request cannot be found', async () => {
    answering(404, '{"message":"Not Found"}')
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)
    type('github.com/owner/private/pull/1')
    fireEvent.click(open())

    await waitFor(() => {
      expect(steps()).toBeInTheDocument()
    })
    expect(screen.getByText(/Pull requests: Read-only/)).toBeInTheDocument()
  })

  it('opens itself when the token in hand was rejected', async () => {
    answering(401, '{"message":"Bad credentials"}')
    render(
      <SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} token="github_pat_stale" />,
    )
    type('github.com/owner/private/pull/1')
    fireEvent.click(open())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('rejected your token')
    })
  })

  /** A failure a token cannot fix should not suggest one. */
  it('stays shut for a failure a token would not help with', async () => {
    answering(406, '{"message":"Too large"}')
    render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)
    type('github.com/owner/repo/pull/1')
    fireEvent.click(open())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('will not generate')
    })
    expect(steps()).not.toBeInTheDocument()
  })
})

/**
 * One size for everything on this screen.
 *
 * Every field and button had written its own padding — `py-1.5 text-xs` on
 * the two inputs, `py-2 text-sm` on the sample rows, `py-1.5 text-sm` on a
 * raw `<button>` that had never been a `Button` at all — so nothing lined up
 * with anything beside it. They come from `ui/button`, `ui/input` and
 * `ui/textarea` now, which are shadcn's files unedited, so the measurement
 * is whatever shadcn ships rather than one chosen here.
 */
describe('one size for the whole picker', () => {
  const controls = (container: HTMLElement): HTMLElement[] => [
    ...container.querySelectorAll<HTMLElement>('button, input:not([type="file"])'),
  ]

  it('gives every button and field the same height', () => {
    const { container } = render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: /Read a private repository/ }))

    const found = controls(container)
    expect(found.length).toBeGreaterThan(10)
    // shadcn's own default, which is what every one of them now takes.
    for (const control of found) expect(control.className).toContain('h-8')
  })

  it('leaves no control writing its own padding', () => {
    const { container } = render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: /Read a private repository/ }))

    // py-1.5 and text-xs were the hand-written ones. Nothing carries them
    // now: the measurements all come from ui/button, ui/input, ui/textarea.
    for (const control of controls(container)) {
      expect(control.className).not.toContain('py-1.5')
      expect(control.className).not.toContain('text-xs')
    }
  })

  it('sizes the one multi-line field like the rest, minus its height', () => {
    const { container } = render(<SourcePicker onLoad={vi.fn()} onTokenChange={() => undefined} />)
    const textarea = container.querySelector('textarea')
    expect(textarea?.className).toContain('md:text-sm')
    expect(textarea?.className).toContain('px-2.5')
    expect(textarea?.className).toContain('min-h-16')
  })
})
