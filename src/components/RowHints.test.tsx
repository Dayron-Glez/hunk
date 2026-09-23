import { act, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { RowHints } from './RowHints'

/** A scroller with two hinted controls in it, as a row would have. */
function scene(): { container: HTMLDivElement; first: HTMLElement; second: HTMLElement } {
  const container = document.createElement('div')
  container.innerHTML =
    '<button data-hint="Show the lines above.">up</button>' +
    '<span data-hint="A piece of the file."><em>inner</em></span>' +
    '<span>no hint here</span>'
  document.body.append(container)
  return {
    container,
    first: container.querySelector('button')!,
    second: container.querySelector('em')!,
  }
}

const move = (on: HTMLElement): void => {
  act(() => {
    on.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
  })
}

/** The hint lands on an animation frame, so tests have to let one pass. */
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  })
}

describe('one tooltip for every row', () => {
  it('shows what the control under the pointer is for', async () => {
    const { container, first } = scene()
    const ref = createRef<HTMLElement>()
    Object.assign(ref, { current: container })
    render(<RowHints containerRef={ref} />)

    move(first)
    await settle()
    expect(screen.getByText('Show the lines above.')).toBeInTheDocument()
  })

  it('finds the hint on an ancestor, not only on what was hovered', async () => {
    const { container, second } = scene()
    const ref = createRef<HTMLElement>()
    Object.assign(ref, { current: container })
    render(<RowHints containerRef={ref} />)

    // The pointer is over the inner element; the hint is on its parent.
    move(second)
    await settle()
    expect(screen.getByText('A piece of the file.')).toBeInTheDocument()
  })

  it('shows nothing over something with no hint', async () => {
    const { container } = scene()
    const ref = createRef<HTMLElement>()
    Object.assign(ref, { current: container })
    render(<RowHints containerRef={ref} />)

    move(container.querySelectorAll('span')[1]!)
    await settle()
    expect(screen.queryByText('A piece of the file.')).not.toBeInTheDocument()
  })

  it('swaps to the next control rather than keeping the last one', async () => {
    const { container, first, second } = scene()
    const ref = createRef<HTMLElement>()
    Object.assign(ref, { current: container })
    render(<RowHints containerRef={ref} />)

    move(first)
    await settle()
    move(second)
    await settle()

    expect(screen.queryByText('Show the lines above.')).not.toBeInTheDocument()
    expect(screen.getByText('A piece of the file.')).toBeInTheDocument()
  })

  it('goes away when the list scrolls under the pointer', async () => {
    const { container, first } = scene()
    const ref = createRef<HTMLElement>()
    Object.assign(ref, { current: container })
    render(<RowHints containerRef={ref} />)

    move(first)
    await settle()
    act(() => {
      container.dispatchEvent(new Event('scroll'))
    })
    expect(screen.queryByText('Show the lines above.')).not.toBeInTheDocument()
  })

  /**
   * It is for the pointer and says so. The row controls are out of the tab
   * order — the grid is the one tab stop — so nothing here is ever focused,
   * and a screen reader gets the label the control already carries.
   */
  it('is hidden from a screen reader rather than read out twice', async () => {
    const { container, first } = scene()
    const ref = createRef<HTMLElement>()
    Object.assign(ref, { current: container })
    render(<RowHints containerRef={ref} />)

    move(first)
    await settle()
    const tip = screen.getByText('Show the lines above.')
    expect(tip).toHaveAttribute('aria-hidden', 'true')
    expect(tip.className).toContain('pointer-events-none')
  })

  it('renders nothing at all until the pointer is over something', () => {
    const ref = createRef<HTMLElement>()
    Object.assign(ref, { current: document.createElement('div') })
    const { container } = render(<RowHints containerRef={ref} />)
    expect(container).toBeEmptyDOMElement()
  })
})
