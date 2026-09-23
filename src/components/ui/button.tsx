import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

/**
 * The button of the chrome, in shadcn's shape.
 *
 * The focus ring is not decoration: it is the one indicator a keyboard user
 * has, and the contrast of every colour below was measured against the
 * background it composites onto rather than chosen by eye.
 */
const BASE =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-sm font-medium ' +
  'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-sky-400 disabled:pointer-events-none disabled:opacity-40'

const VARIANTS = {
  primary: 'bg-sky-700 text-white hover:bg-sky-600',
  outline:
    'border border-neutral-800 text-neutral-300 hover:border-neutral-600 hover:text-neutral-100',
  ghost: 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-100',
}

const SIZES = { sm: 'h-7 px-2 text-xs', md: 'h-9 px-3' }

export type ButtonProps = ComponentProps<'button'> & {
  readonly variant?: keyof typeof VARIANTS
  readonly size?: keyof typeof SIZES
}

export function Button({
  className,
  variant = 'outline',
  size = 'md',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...props}
    />
  )
}
