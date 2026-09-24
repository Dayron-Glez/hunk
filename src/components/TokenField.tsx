import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { forgetToken, storageWorks, validateToken, writeToken } from '../core/source/token'
import { cn } from '../lib/utils'
import { QUIET_FOCUS } from './fields'
import { Button } from './ui/button'
import { Input } from './ui/input'

/** Where a fine-grained token is made, which is not where a classic one is. */
const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

/**
 * Making the token, in the order GitHub's own page asks for it.
 *
 * Steps rather than a paragraph. It was a paragraph, and a paragraph is
 * where "Pull requests and Contents, read-only" goes to hide: a reader
 * following it on a second screen has to find their place in a run-on
 * sentence every time they look back at it.
 */
const STEPS: readonly { readonly title: string; readonly detail: string }[] = [
  { title: 'Repository access', detail: 'Only select repositories — just the ones you need.' },
  {
    title: 'Permissions',
    detail: 'Pull requests: Read-only, and Contents: Read-only. Metadata is added for you.',
  },
  { title: 'Expiration', detail: 'Set a date. This is a key living in a browser.' },
]

/**
 * The reader's own GitHub token, for the repositories that are theirs.
 *
 * Checked before it is kept. `rate_limit` costs nothing against the limit it
 * reports, so the reader learns the token works here rather than by opening a
 * diff and being told it does not.
 *
 * What it is worth saying plainly: this is a credential in a browser. It is
 * kept in local storage, which any script served from this page could read.
 * hunk renders diffs as text and never as markup, so there is little to run
 * — but "little" is not "none", and the honest answer is to scope the token
 * to what it needs and give it an expiry, which is what the steps say.
 *
 * Two permissions, because two endpoints: the diff is one pull request read,
 * and each file behind a gap is one contents read. Naming only Contents sent
 * the reader back with a token that answers 404 for the diff itself.
 *
 * Whether the panel is open belongs to the caller, not to this component. A
 * reader who has just been told a pull request might be private should not
 * then have to notice a quiet grey button to act on it.
 */
export function TokenField({
  token,
  onChange,
  open,
  onOpenChange,
}: {
  readonly token: string | null
  readonly onChange: (token: string | null) => void
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const [draft, setDraft] = useState('')
  const [checking, setChecking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const save = (event: FormEvent): void => {
    event.preventDefault()
    const candidate = draft.trim()
    if (candidate === '' || checking) return

    setChecking(true)
    setProblem(null)
    void validateToken(candidate).then((check) => {
      setChecking(false)

      if (!check.ok) {
        // Both, and not the same words. The toast carries the news to a
        // reader whose eyes had already left the field; the line under it
        // keeps the detail and the way out, and does not time out while
        // they read it.
        setProblem(
          check.reason === 'rejected'
            ? 'GitHub did not accept that token. Check it was copied whole, and that it has not expired.'
            : `The check never reached GitHub: ${check.detail}.`,
        )
        toast.error(
          check.reason === 'rejected'
            ? 'GitHub rejected that token.'
            : 'The token could not be checked — GitHub was not reachable.',
        )
        return
      }

      writeToken(candidate)
      setDraft('')
      onOpenChange(false)
      onChange(candidate)
      // The panel closes on success, so there is nowhere left to say this.
      toast.success(
        `Token accepted — ${check.limit.toLocaleString('en-GB')} requests an hour, private repositories included.`,
      )
    })
  }

  const forget = (): void => {
    forgetToken()
    onChange(null)
    toast.success('Token forgotten. Public repositories only, sixty requests an hour.')
  }

  if (token !== null) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
        <ShieldCheck aria-hidden className="size-4 text-emerald-400" />
        {/* The ceiling is already stated beside the pull request field; this
            line says whose credential is in use and how to stop using it. */}
        <span>Reading as you, including the private repositories your token was granted.</span>
        <Button variant="ghost" onClick={forget}>
          Forget this token
        </Button>
      </p>
    )
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        className="w-fit px-0 hover:bg-transparent"
        onClick={() => {
          onOpenChange(true)
        }}
      >
        <KeyRound aria-hidden className="size-3.5" />
        Read a private repository
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-800 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-neutral-100">Read a private repository</h2>
        <p className="text-xs text-neutral-400">
          hunk asks GitHub from your browser, so it needs a key of your own.
        </p>
      </div>

      <ol className="flex flex-col gap-2 text-xs text-neutral-300">
        <li className="flex gap-2">
          <Step n={1} />
          <span>
            Open{' '}
            <a
              href={NEW_TOKEN_URL}
              target="_blank"
              rel="noreferrer"
              className="text-sky-400 underline underline-offset-4"
            >
              GitHub&rsquo;s new fine-grained token page
            </a>
            .
          </span>
        </li>
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-2">
            <Step n={index + 2} />
            <span>
              <span className="font-medium text-neutral-100">{step.title}</span> &mdash;{' '}
              {step.detail}
            </span>
          </li>
        ))}
        <li className="flex gap-2">
          <Step n={STEPS.length + 2} />
          <span>Generate it, and paste it here.</span>
        </li>
      </ol>

      <label htmlFor="gh-token" className="sr-only">
        A GitHub personal access token
      </label>
      {/* Its own form, so Enter checks the token rather than submitting the
          pull request beside it. It has to stay a sibling of that one: a
          form inside a form is not a thing HTML has, React refuses it, and
          the press reloads the page instead of running the handler. */}
      {/* Wrapping, because at a phone's width the field and two buttons on
          one line left 121px to paste a ninety-character token into. The
          buttons drop below it rather than squeezing it. */}
      <form onSubmit={save} className="flex flex-wrap gap-2">
        <Input
          id="gh-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setProblem(null)
          }}
          placeholder="github_pat_…"
          aria-describedby={problem === null ? 'token-note' : 'token-problem'}
          aria-invalid={problem !== null}
          className={`min-w-48 flex-1 font-mono ${QUIET_FOCUS}`}
        />
        <Button
          type="submit"
          variant="default"
          aria-busy={checking}
          disabled={draft.trim() === '' || checking}
        >
          {/* Both labels in one grid cell, so the button stays as wide as the
              longer of them. Swapping the text instead shrank it from 102 to
              96 pixels mid-request and moved the field beside it — the same
              defect the pull request button was already fixed for, written
              again here. */}
          <span className="grid place-items-center">
            <span
              className={cn('col-start-1 row-start-1', checking && 'invisible')}
              aria-hidden={checking}
            >
              Check and keep
            </span>
            <span
              className={cn(
                'col-start-1 row-start-1 flex items-center gap-1.5',
                !checking && 'invisible',
              )}
              aria-hidden={!checking}
            >
              <Loader2 aria-hidden className="size-3.5 motion-safe:animate-spin" />
              Checking&hellip;
            </span>
          </span>
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            onOpenChange(false)
            setDraft('')
            setProblem(null)
          }}
        >
          Cancel
        </Button>
      </form>

      {problem !== null ? (
        <p id="token-problem" role="alert" className="text-xs text-amber-200/90">
          {problem}
        </p>
      ) : (
        <p id="token-note" className="text-xs leading-relaxed text-neutral-400">
          Sent to api.github.com and nowhere else, and never put in the address bar.{' '}
          {storageWorks()
            ? 'It stays in this browser until you forget it — anything running on this page could read it, which is why it is worth scoping narrowly.'
            : 'This browser is not letting hunk store anything, so the token will last until you reload.'}
        </p>
      )}
    </div>
  )
}

/** The number beside a step, so the steps line up under one another. */
function Step({ n }: { readonly n: number }) {
  return (
    <span
      aria-hidden
      className="mt-px grid size-4 shrink-0 place-items-center rounded-full bg-neutral-800 text-[10px] text-neutral-300 tabular-nums"
    >
      {n}
    </span>
  )
}
