/** What crosses the worker boundary. Shared so both sides agree on one shape. */

export interface HighlightRequest {
  readonly id: number
  readonly lang: string
  readonly text: string
}

export interface HighlightSuccess {
  readonly id: number
  readonly ok: true
  readonly palette: readonly string[]
  readonly lineStarts: Uint32Array
  readonly ends: Uint32Array
  readonly styles: Uint32Array
}

export interface HighlightFailure {
  readonly id: number
  readonly ok: false
  readonly reason: string
}

export type HighlightResponse = HighlightSuccess | HighlightFailure

/** The theme the worker resolves colours against. */
export const THEME = 'github-dark'
