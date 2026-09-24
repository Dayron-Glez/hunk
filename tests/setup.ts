import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)

/**
 * jsdom never lays out — every element is zero by zero — and has no
 * `ResizeObserver`. Without these stubs a virtualized list renders nothing and
 * the tests prove that nothing is nothing. Crude on purpose: the real numbers
 * come from the benchmark, in a real browser.
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
  /* eslint-disable @typescript-eslint/no-empty-function -- nothing resizes in a test */
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  /* eslint-enable @typescript-eslint/no-empty-function */
}

/**
 * jsdom declares `matchMedia` and never implements it, and sonner asks it
 * whether the reader prefers a dark colour scheme. Guarded on the type and
 * not on `in`, which is true for a property that is only ever `undefined`.
 * Answers no to everything: a test that cares about a media query should say
 * so itself rather than inherit one.
 */
if (typeof globalThis.matchMedia !== 'function') {
  globalThis.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })
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
