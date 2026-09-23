import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * One tooltip for every row on screen.
 *
 * Radix gives each trigger its own instance, which is right for the handful
 * of controls in the chrome and wrong here: about ninety rows are rendered at
 * a time and they are replaced as the reader scrolls, so a tooltip per
 * control would mean a hundred and eighty of them mounting and unmounting
 * continuously. The rows carry a `data-hint` attribute instead, and this
 * single element follows the pointer to whichever one it is over.
 *
 * Pointer only, deliberately. There is nothing to focus: the row controls are
 * out of the tab order — the grid is the one tab stop — so a keyboard reader
 * never lands on one and never needs this. What they get instead is the
 * label the control already carries for a screen reader.
 */
export function RowHints({
  containerRef,
}: {
  readonly containerRef: { current: HTMLElement | null }
}) {
  const [hint, setHint] = useState<{ text: string; x: number; y: number } | null>(null)
  const frame = useRef(0)

  const clear = useCallback(() => {
    setHint(null)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return

    const onMove = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const holder = target.closest<HTMLElement>('[data-hint]')

      if (holder === null) {
        if (frame.current !== 0) cancelAnimationFrame(frame.current)
        frame.current = 0
        setHint(null)
        return
      }

      const box = holder.getBoundingClientRect()
      const text = holder.dataset.hint ?? ''
      // One update per frame at most: this runs on every pointer move over a
      // list that is already doing work as it scrolls.
      if (frame.current !== 0) cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        setHint({ text, x: box.left, y: box.bottom + 6 })
      })
    }

    container.addEventListener('pointermove', onMove)
    container.addEventListener('pointerleave', clear)
    container.addEventListener('scroll', clear, { passive: true })
    return () => {
      container.removeEventListener('pointermove', onMove)
      container.removeEventListener('pointerleave', clear)
      container.removeEventListener('scroll', clear)
      if (frame.current !== 0) cancelAnimationFrame(frame.current)
    }
  }, [containerRef, clear])

  if (hint === null) return null

  return (
    <div
      // Not a live region and not announced: a screen reader gets the label
      // the control already carries, and hearing it twice helps nobody.
      aria-hidden
      role="presentation"
      style={{ left: hint.x, top: hint.y }}
      className="pointer-events-none fixed z-50 max-w-xs rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-100 shadow-lg"
    >
      {hint.text}
    </div>
  )
}
