import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)

/**
 * jsdom parses and builds a DOM but never lays it out: every element is zero by
 * zero and `ResizeObserver` does not exist at all. A virtualized list asks both
 * of those questions constantly, so without the stubs below it renders nothing
 * and the tests would only prove that nothing is nothing.
 *
 * These are deliberately crude. They make the component answerable in a test,
 * not realistic — the real numbers come from the benchmark, in a real browser.
 */
declare global {
  /** Viewport height the stubbed `clientHeight` reports. Tests set it directly. */
  var testViewportHeight: number
  /** Height every element reports from `getBoundingClientRect`. */
  var testRowHeight: number
}

globalThis.testViewportHeight = 800
globalThis.testRowHeight = 20

if (!('ResizeObserver' in globalThis)) {
  // Nothing in a test ever resizes, so an observer that never fires is an
  // accurate stand-in rather than a shortcut.
  globalThis.ResizeObserver = class {
    observe(): void {
      // jsdom never lays out, so nothing to report.
    }
    unobserve(): void {
      // See observe.
    }
    disconnect(): void {
      // See observe.
    }
  }
}

Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get(): number {
    return globalThis.testViewportHeight
  },
})

Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
  configurable: true,
  get(): number {
    return globalThis.testViewportHeight
  },
})

Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
  const height = globalThis.testRowHeight
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: height,
    width: 800,
    height,
    toJSON: () => ({}),
  }
}
