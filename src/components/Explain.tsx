import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

/**
 * A short explanation attached to something on screen.
 *
 * Diffs are full of notation that only makes sense if you already know it —
 * `@@ -572,26 +572,46 @@` is the clearest example. A reader who has never
 * read a unified diff should be able to find out what they are looking at
 * without leaving the page.
 *
 * `asChild` so the trigger is the element itself rather than a wrapper around
 * it: an extra button around a button is two tab stops for one control.
 */
export function Explain({
  children,
  text,
  side = 'bottom',
}: {
  readonly children: ReactNode
  readonly text: ReactNode
  readonly side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{text}</TooltipContent>
    </Tooltip>
  )
}
