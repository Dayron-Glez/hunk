import type { CSSProperties, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

interface ExplainProps {
  children: ReactNode
  text: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  width?: CSSProperties['width']
}

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
export function Explain({ children, text, side = 'bottom', width }: Readonly<ExplainProps>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        style={
          width === undefined
            ? undefined
            : { width, maxWidth: 'var(--radix-tooltip-content-available-width)' }
        }
      >
        {text}
      </TooltipContent>
    </Tooltip>
  )
}
