import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TokenField } from './TokenField'
import { Toaster } from './ui/sonner'

const KEY = 'hunk.github-token'
const LIMIT = JSON.stringify({ resources: { core: { limit: 5000, remaining: 5000, reset: 0 } } })

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const answering = (status: number, body = LIMIT): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(body, { status }))),
  )
}

/** The panel's openness belongs to the caller now, so a test has to be one. */
function Harness({
  startWith = null,
  startOpen = false,
  onChange = () => undefined,
}: {
  readonly startWith?: string | null
  readonly startOpen?: boolean
  readonly onChange?: (token: string | null) => void
}) {
  const [token, setToken] = useState<string | null>(startWith)
  const [open, setOpen] = useState(startOpen)
  return (
    <>
      <Toaster />
      <TokenField
        token={token}
        open={open}
        onOpenChange={setOpen}
        onChange={(next) => {
          setToken(next)
          onChange(next)
        }}
      />
    </>
  )
}

const reveal = (): void => {
  fireEvent.click(screen.getByRole('button', { name: /Read a private repository/ }))
}

const enter = (value: string): void => {
  fireEvent.change(screen.getByLabelText(/personal access token/), { target: { value } })
}

const check = (): void => {
  fireEvent.click(screen.getByRole('button', { name: /Check and keep/ }))
}

describe('offering one', () => {
  it('stays out of the way until it is asked for', () => {
    render(<Harness />)
    expect(screen.queryByLabelText(/personal access token/)).not.toBeInTheDocument()
  })

  it('opens when the reader asks for it', () => {
    render(<Harness />)
    reveal()
    expect(screen.getByLabelText(/personal access token/)).toBeInTheDocument()
  })

  /** A token typed into a text field is a token read over a shoulder, and
   *  shown to anything that screenshots the page. */
  it('never shows the token as it is typed', () => {
    render(<Harness startOpen />)
    expect(screen.getByLabelText(/personal access token/)).toHaveAttribute('type', 'password')
  })

  /**
   * The instructions used to be one paragraph behind a grey button, which is
   * the same as not having them. Numbered steps, in the order GitHub's own
   * page asks for them, so a reader can follow along on a second screen and
   * find their place again each time they look back.
   */
  it('spells out how to make the token, as steps', () => {
    render(<Harness startOpen />)
    const steps = screen.getAllByRole('listitem')
    expect(steps.length).toBeGreaterThanOrEqual(5)

    const said = steps.map((step) => step.textContent ?? '').join(' ')
    expect(said).toContain('Repository access')
    expect(said).toContain('Only select repositories')
    expect(said).toContain('Pull requests: Read-only')
    expect(said).toContain('Contents: Read-only')
    expect(said).toContain('Expiration')
  })

  it('links straight at the page that makes one', () => {
    render(<Harness startOpen />)
    expect(screen.getByRole('link', { name: /fine-grained token page/ })).toHaveAttribute(
      'href',
      'https://github.com/settings/personal-access-tokens/new',
    )
  })

  it('says where the token goes, and where it does not', () => {
    render(<Harness startOpen />)
    const note = screen.getByText(/api\.github\.com and nowhere else/)
    expect(note).toHaveTextContent('never put in the address bar')
  })

  /** It is a credential in a browser. Saying otherwise, or saying nothing,
   *  would be the dishonest option. */
  it('admits that anything on the page could read it', () => {
    render(<Harness startOpen />)
    expect(screen.getByText(/anything running on this page could read it/)).toBeInTheDocument()
  })
})

describe('checking it before keeping it', () => {
  it('keeps one GitHub accepts, and hands it up', async () => {
    answering(200)
    const onChange = vi.fn()
    render(<Harness startOpen onChange={onChange} />)
    enter('github_pat_good')
    check()

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('github_pat_good')
    })
    expect(localStorage.getItem(KEY)).toBe('github_pat_good')
  })

  it('keeps nothing GitHub rejects', async () => {
    answering(401, '{"message":"Bad credentials"}')
    const onChange = vi.fn()
    render(<Harness startOpen onChange={onChange} />)
    enter('nope')
    check()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('did not accept that token')
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('tells a rejected token from a GitHub it could not reach', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    render(<Harness startOpen />)
    enter('github_pat_good')
    check()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('never reached GitHub')
    })
  })

  it('spends no request on an empty field', () => {
    const spy = vi.fn(() => Promise.resolve(new Response(LIMIT)))
    vi.stubGlobal('fetch', spy)
    render(<Harness startOpen />)
    expect(screen.getByRole('button', { name: /Check and keep/ })).toBeDisabled()
    expect(spy).not.toHaveBeenCalled()
  })

  it('leaves nothing behind when the reader changes their mind', () => {
    render(<Harness startOpen />)
    enter('github_pat_good')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText(/personal access token/)).not.toBeInTheDocument()
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})

/**
 * Every outcome says so out loud. Two of them have nowhere else to: the
 * panel closes on success, and forgetting a token collapses the line that
 * would have carried the news. The two failures keep their inline sentence
 * as well, in different words — the toast is the news, the line is the
 * detail and the way out, and it does not time out while it is being read.
 */
describe('what the reader is told, out loud', () => {
  it('says what an accepted token bought', async () => {
    answering(200)
    render(<Harness startOpen />)
    enter('github_pat_good')
    check()

    expect(await screen.findByText(/Token accepted — 5,000 requests an hour/)).toBeInTheDocument()
  })

  it('says a rejected one was rejected', async () => {
    answering(401, '{"message":"Bad credentials"}')
    render(<Harness startOpen />)
    enter('nope')
    check()

    expect(await screen.findByText('GitHub rejected that token.')).toBeInTheDocument()
  })

  it('says when the check never got there', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    render(<Harness startOpen />)
    enter('github_pat_good')
    check()

    expect(await screen.findByText(/GitHub was not reachable/)).toBeInTheDocument()
  })

  it('says what forgetting one costs', async () => {
    render(<Harness startWith="github_pat_secret" />)
    fireEvent.click(screen.getByRole('button', { name: /Forget this token/ }))

    expect(
      await screen.findByText(/Public repositories only, sixty requests an hour/),
    ).toBeInTheDocument()
  })
})

describe('once there is one', () => {
  it('says whose credential is in use, without showing it', () => {
    render(<Harness startWith="github_pat_secret" />)
    expect(screen.getByText(/private repositories your token was granted/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('github_pat_secret')
  })

  it('forgets it everywhere at once', () => {
    localStorage.setItem(KEY, 'github_pat_secret')
    const onChange = vi.fn()
    render(<Harness startWith="github_pat_secret" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Forget this token/ }))

    expect(localStorage.getItem(KEY)).toBeNull()
    expect(onChange).toHaveBeenCalledWith(null)
  })
})

/** A private window throws on access rather than returning nothing. The
 *  reader should not be promised the token will survive a reload. */
describe('a browser that will not store anything', () => {
  it('says the token lasts only until the page is reloaded', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied')
    })
    render(<Harness startOpen />)
    expect(screen.getByText(/last until you reload/)).toBeInTheDocument()
  })
})

/**
 * The same defect the pull request button was fixed for, written again
 * here: swapping "Check and keep" for "Checking…" shrank the button from
 * 102 to 96 pixels mid-request, and the field beside it grew to match —
 * moving the token the reader had just pasted.
 *
 * And at a phone's width that field had 121 pixels of a 293-pixel row to
 * hold a ninety-character token, because it was sharing the line with two
 * buttons that would not wrap.
 */
describe('the row holding the token', () => {
  // Once it is working, the live label is the only one with a name.
  const submit = (): HTMLElement =>
    screen.getByRole('button', { name: /^(Check and keep|Checking…)$/ })

  const labels = (): { text: string; hidden: string | null }[] =>
    Array.from(submit().querySelectorAll('span > span')).map((el) => ({
      text: (el.textContent ?? '').trim(),
      hidden: el.getAttribute('aria-hidden'),
    }))

  const held = (): typeof fetch => () => new Promise<Response>(() => undefined)

  it('carries both labels at once, with only one of them alive', () => {
    render(<Harness startOpen />)
    const both = labels()
    expect(both.map((l) => l.text)).toEqual(['Check and keep', 'Checking…'])
    expect(both.map((l) => l.hidden)).toEqual(['false', 'true'])
  })

  it('swaps which one is alive rather than which one exists', async () => {
    vi.stubGlobal('fetch', held())
    render(<Harness startOpen />)
    enter('github_pat_good')
    check()

    await waitFor(() => {
      expect(labels().map((l) => l.hidden)).toEqual(['true', 'false'])
    })
    // Both are still in the button, so its width cannot have changed.
    expect(labels().map((l) => l.text)).toEqual(['Check and keep', 'Checking…'])
  })

  it('says it is busy while it is', async () => {
    vi.stubGlobal('fetch', held())
    render(<Harness startOpen />)
    enter('github_pat_good')
    check()

    await waitFor(() => {
      expect(submit()).toHaveAttribute('aria-busy', 'true')
    })
  })

  it('lets the buttons drop below the field rather than squeeze it', () => {
    render(<Harness startOpen />)
    const form = screen.getByLabelText(/personal access token/).closest('form')
    expect(form?.className).toContain('flex-wrap')
    expect(screen.getByLabelText(/personal access token/).className).toContain('min-w-48')
  })
})
