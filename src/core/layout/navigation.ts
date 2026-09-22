import type { Folding } from './folding'
import { RowKind, type RowIndex } from './rowIndex'

/**
 * Where a keystroke takes the reader.
 *
 * Named by intent rather than by key, so the bindings live with the component
 * and the arithmetic can be tested without a keyboard.
 */
export type Move =
  | 'next-row'
  | 'previous-row'
  | 'next-hunk'
  | 'previous-hunk'
  | 'next-file'
  | 'previous-file'
  | 'next-page'
  | 'previous-page'
  | 'first'
  | 'last'

/**
 * The position a move lands on, in the visible numbering.
 *
 * Positions, not rows: a move is through what the reader can see, so a folded
 * file is one stop rather than the two thousand lines inside it. Everything
 * clamps — running off either end leaves you at the end, which is what a
 * reader holding a key down expects.
 *
 * `pageRows` is how many rows a screen holds, which only the component knows.
 */
export function moveFrom(
  rows: RowIndex,
  folding: Folding,
  from: number,
  move: Move,
  pageRows: number,
): number {
  const last = folding.length - 1
  if (last < 0) return 0

  const start = clamp(from, 0, last)
  const page = Math.max(1, Math.floor(pageRows))

  switch (move) {
    case 'first':
      return 0
    case 'last':
      return last
    case 'next-row':
      return clamp(start + 1, 0, last)
    case 'previous-row':
      return clamp(start - 1, 0, last)
    case 'next-page':
      return clamp(start + page, 0, last)
    case 'previous-page':
      return clamp(start - page, 0, last)
    case 'next-hunk':
      return seek(rows, folding, start, 1, isHunkStart) ?? last
    case 'previous-hunk':
      return seek(rows, folding, start, -1, isHunkStart) ?? 0
    case 'next-file':
      return seek(rows, folding, start, 1, isFileStart) ?? last
    case 'previous-file':
      return seek(rows, folding, start, -1, isFileStart) ?? 0
  }
}

/**
 * The first position of the window, for a reader who scrolled with the mouse
 * and then reached for the keyboard. Starting from a focus they left behind
 * would scroll them somewhere they are not looking.
 */
export function startingPosition(focused: number | null, first: number, last: number): number {
  if (focused === null || focused < first || focused > last) return first
  return focused
}

/** A file header is also the start of its first hunk, so 'next-hunk' from a
 *  file header does not stand still. */
function isHunkStart(kind: RowKind): boolean {
  return kind === RowKind.HunkHeader || kind === RowKind.FileHeader
}

function isFileStart(kind: RowKind): boolean {
  return kind === RowKind.FileHeader
}

/** The nearest position in `step` direction whose row passes, or null. */
function seek(
  rows: RowIndex,
  folding: Folding,
  from: number,
  step: 1 | -1,
  passes: (kind: RowKind) => boolean,
): number | null {
  for (let position = from + step; position >= 0 && position < folding.length; position += step) {
    const row = folding.rowAt(position)
    if (row !== -1 && passes(rows.kindAt(row))) return position
  }
  return null
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value
}
