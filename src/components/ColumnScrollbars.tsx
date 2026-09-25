/**
 * The horizontal scrollbars for one file, inside that file's header row.
 *
 * They are the scrolling elements. The cells below them clip and are moved by
 * a transform, so a bar here moves a whole column of that file at once —
 * where before each cell scrolled on its own and moving one long line left
 * the line beneath it behind. Driving it from the bar rather than from a
 * number of our own also means the browser does the clamping: a bar cannot be
 * scrolled past its own content, so nothing here works out how far is too far.
 *
 * Held against the bottom of its own file, which is where a scrollbar belongs
 * and where an editor puts it. It overlays the bottom edge of the view while
 * the file runs past it, and comes to rest on the file's last rows — which
 * carry a strip's worth of padding for exactly that, so it never covers a
 * line of code. Putting it in the file's header instead was tried and reads
 * as the wrong end of the file.
 *
 * Native, deliberately. A scroll area from a component library would replace
 * the element the virtualizer, the resize observer, the row hints and the
 * benchmark all hold on to, and would put a listener between the reader and
 * the frame. Styling the browser's own costs none of that.
 *
 * What each bar reports is how far its column **overflows**, not how wide its
 * content is. The two are not the same: the line numbers and the marker take
 * part of the column, so the box that clips a line is narrower than the
 * column itself, and sizing the bar by the content left it unable to reach
 * the end of the longest line. `calc(100% + overflow)` makes the distance the
 * bar can travel exactly the distance the line has to move.
 *
 * **That overflow is the widest row of the file that has been rendered, not
 * its widest row.** This viewer will not measure lines nobody has scrolled
 * to, so it cannot know the second one. A bar therefore changes size as the
 * reader moves down a long file. That was already true of the unified
 * scrollbar; showing it makes it visible too.
 */
/** How tall the strip is, and how much padding the last rows of a file carry
 *  so that it comes to rest on space rather than on code. */
export const BAR_HEIGHT = 12

export function ColumnScrollbars({
  file,
  ratio,
  widths,
  onScroll,
}: {
  readonly file: number
  /** Where this file's seam sits, so each bar is as wide as its column. */
  readonly ratio: number
  /** How far each column overflows the box that clips it. */
  readonly widths: { readonly old: number; readonly new: number }
  readonly onScroll: (file: number, column: 'old' | 'new', scrollLeft: number) => void
}) {
  return (
    <div
      data-bars={file}
      aria-hidden
      /*
        Out of the way until it is wanted, which is how an editor treats one.
        Invisible while the pointer is in another file, half there while it is
        in this one, and fully there while it is on the bar itself. That is
        what lets it lie over the bottom line rather than take a row's worth
        of space from every file.
      */
      className="absolute top-0 left-0 z-30 flex opacity-0 transition-opacity duration-150 hover:opacity-100 data-[near]:opacity-60"
      style={{ height: BAR_HEIGHT }}
    >
      <Bar file={file} column="old" overflow={widths.old} share={ratio} onScroll={onScroll} />
      <Bar file={file} column="new" overflow={widths.new} share={1 - ratio} onScroll={onScroll} />
    </div>
  )
}

/** Thin, and in the viewer's own greys rather than the platform's. */
const BAR =
  'h-full overflow-x-auto overflow-y-hidden [scrollbar-color:var(--color-neutral-600)_transparent] [scrollbar-width:thin]'

function Bar({
  file,
  column,
  overflow,
  share,
  onScroll,
}: {
  readonly file: number
  readonly column: 'old' | 'new'
  readonly overflow: number
  readonly share: number
  readonly onScroll: (file: number, column: 'old' | 'new', scrollLeft: number) => void
}) {
  return (
    <div
      data-bar={column}
      style={{ width: `${share * 100}%` }}
      className={BAR}
      onScroll={(event) => {
        onScroll(file, column, event.currentTarget.scrollLeft)
      }}
    >
      {/* Exactly as much further than the bar as the line has to move. */}
      <div style={{ width: `calc(100% + ${String(overflow)}px)`, height: 1 }} />
    </div>
  )
}
