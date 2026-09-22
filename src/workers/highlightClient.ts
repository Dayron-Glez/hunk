import type { HighlightResponse } from '../core/highlight/protocol'
import type { FlatTokens } from '../core/highlight/tokens'

/**
 * Talks to the highlight worker, and answers null whenever it cannot.
 *
 * Null is a first-class result, not an error path: no grammar, no worker, a
 * grammar that failed to download. The viewer renders plain text and stays
 * readable, which is the whole point of not making colour a dependency.
 */
export class HighlightClient {
  private worker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<number, (tokens: FlatTokens | null) => void>()
  private broken = false

  highlight(lang: string, text: string): Promise<FlatTokens | null> {
    const worker = this.ensureWorker()
    if (worker === null) return Promise.resolve(null)

    const id = this.nextId
    this.nextId += 1

    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      worker.postMessage({ id, lang, text })
    })
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    for (const resolve of this.pending.values()) resolve(null)
    this.pending.clear()
  }

  private ensureWorker(): Worker | null {
    if (this.broken) return null
    if (this.worker !== null) return this.worker

    try {
      const worker = new Worker(new URL('./highlight.worker.ts', import.meta.url), {
        type: 'module',
      })
      worker.onmessage = (event: MessageEvent<HighlightResponse>) => {
        this.settle(event.data)
      }
      // A worker that dies takes its queue with it, so release every caller
      // rather than leaving promises that never resolve.
      worker.onerror = () => {
        this.broken = true
        this.dispose()
      }
      this.worker = worker
      return worker
    } catch {
      this.broken = true
      return null
    }
  }

  private settle(response: HighlightResponse): void {
    const resolve = this.pending.get(response.id)
    if (resolve === undefined) return
    this.pending.delete(response.id)

    if (!response.ok) {
      resolve(null)
      return
    }
    resolve({
      palette: response.palette,
      lineStarts: response.lineStarts,
      ends: response.ends,
      styles: response.styles,
    })
  }
}
