/**
 * Whether a file's rows are on screen, for the scrollbar that sits at the end
 * of them.
 *
 * The strip is placed straight onto the element by the scroll handler, never
 * through React, which would re-render the whole window on a scroll that did
 * not change which rows are on it. This is the part of that worth testing
 * without a browser.
 */
export interface Block {
  /** The top and bottom of the file's rows, in document coordinates. */
  readonly top: number
  readonly bottom: number
}

export interface Viewport {
  readonly scrollTop: number
  readonly height: number
}

/** Whether any part of the block is on screen at all. */
export function onScreen(block: Block, viewport: Viewport): boolean {
  return block.bottom > viewport.scrollTop && block.top < viewport.scrollTop + viewport.height
}
