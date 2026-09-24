/**
 * How long a message stays up.
 *
 * Not in `ui/sonner`, which is shadcn's file and stays theirs: this is a
 * choice this application makes about it, and it is passed in where the
 * Toaster is rendered.
 *
 * sonner's own default is four seconds, which is fine for "Saved" and short
 * for a sentence. At three words a second, after a second to notice the
 * thing arrived, five affords about twelve words. Every message raised here
 * fits except the three that refuse a dropped file, which run to fifteen and
 * twenty and lean on the close button instead — see `core/source/file`.
 */
export const TOAST_DURATION_MS = 5_000
