/**
 * The focus ring taken off a text field.
 *
 * A reader asked for it: a ring around a field that is already outlined
 * reads heavier than it needs to. Written once and shared so the three
 * fields cannot drift apart, and applied where they are used so `ui/input`
 * and `ui/textarea` stay shadcn's files, unedited and overwritable.
 *
 * What is left is the caret, which is the indicator a text field has always
 * had. Every other control keeps its ring; this is only for the ones you
 * type into.
 */
export const QUIET_FOCUS = 'focus-visible:border-input focus-visible:ring-0'
