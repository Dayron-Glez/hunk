/**
 * Class names, with the empty ones dropped.
 *
 * shadcn's components expect a `cn`, and its own is `clsx` wrapped in
 * `tailwind-merge`. Both were installed, measured and removed: 8.7 kB gzipped
 * to resolve conflicts between Tailwind utilities at two call sites, in a
 * codebase that composes classes with template strings everywhere else and
 * writes no conflicts to resolve.
 */
export function cn(...inputs: (string | false | null | undefined)[]): string {
  return inputs.filter(Boolean).join(' ')
}
