import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

/**
 * A tooltip, from Radix by way of shadcn.
 *
 * Used on the chrome and nowhere else. Inside the diff a tooltip per control
 * would mean one of these mounting and unmounting for every row that scrolls
 * past — about 180 at a time on a full screen — which is the kind of cost
 * this viewer exists to not have. The rows share a single one instead.
 */
export function TooltipProvider({
  delayDuration = 300,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />
}

export function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root {...props} />
}

export function TooltipTrigger(props: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger {...props} />
}

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-xs rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5',
          'text-xs text-neutral-100 shadow-lg',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-neutral-700" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}
