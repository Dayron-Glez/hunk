/// <reference lib="webworker" />
import { createHighlighterCore, type HighlighterCore } from '@shikijs/core'
import { createOnigurumaEngine } from '@shikijs/engine-oniguruma'
import type { HighlightRequest, HighlightResponse } from '../core/highlight/protocol'
import { THEME } from '../core/highlight/protocol'
import { buffersOf, flatten } from '../core/highlight/tokens'
import { GRAMMARS } from './grammars'

/**
 * Syntax highlighting, off the main thread.
 *
 * Two costs put it here rather than inline: warming a grammar is around 170 ms,
 * which must never land near first paint, and a viewport of sixty lines costs
 * about 6 ms — more than a frame, on every scroll.
 *
 * Oniguruma rather than the JavaScript regex engine. It carries 0.6 MB of wasm,
 * but produced identical tokens on 200 lines of real TypeScript at a quarter of
 * the time, and it downloads inside this worker where nothing waits for it.
 */

let core: Promise<HighlighterCore> | null = null
const loaded = new Set<string>()

function highlighter(): Promise<HighlighterCore> {
  core ??= createHighlighterCore({
    themes: [import('@shikijs/themes/github-dark')],
    langs: [],
    engine: createOnigurumaEngine(import('@shikijs/engine-oniguruma/wasm-inlined')),
  })
  return core
}

async function tokenize(request: HighlightRequest): Promise<HighlightResponse> {
  const grammar = GRAMMARS[request.lang]
  if (grammar === undefined) {
    return { id: request.id, ok: false, reason: `no grammar for ${request.lang}` }
  }

  const shiki = await highlighter()
  if (!loaded.has(request.lang)) {
    await shiki.loadLanguage((await grammar()) as Parameters<HighlighterCore['loadLanguage']>[0])
    loaded.add(request.lang)
  }

  const { tokens } = shiki.codeToTokens(request.text, { lang: request.lang, theme: THEME })
  const flat = flatten(tokens)
  return { id: request.id, ok: true, ...flat }
}

self.onmessage = (event: MessageEvent<HighlightRequest>) => {
  const request = event.data
  void tokenize(request)
    .then((response) => {
      // Uncoloured text is readable; a worker that dies is not. Every failure
      // comes back as an answer so the caller can fall back and move on.
      if (!response.ok) {
        self.postMessage(response)
        return
      }
      self.postMessage(response, buffersOf(response))
    })
    .catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      self.postMessage({ id: request.id, ok: false, reason } satisfies HighlightResponse)
    })
}
