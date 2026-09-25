/**
 * The measurement itself, run inside the page by `contrast.mjs`.
 *
 * Self-contained on purpose: Playwright hands the browser this function's
 * source, so anything it does not declare does not exist on the other side.
 * One function for both jobs because they share the colour arithmetic, and
 * `'ring'` has to run between Tab presses driven from outside.
 */
export function inspect(mode) {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  /**
   * Any CSS colour as sRGB bytes.
   *
   * Through a canvas rather than by parsing, because a computed colour comes
   * back in whatever space it was written in — this project's tokens are
   * `oklch()` — and the browser converts and gamut-clips exactly as it does
   * when it paints the pixel.
   */
  const rgba = (css) => {
    ctx.globalCompositeOperation = 'copy'
    ctx.fillStyle = '#000'
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return [r, g, b, a / 255]
  }

  const over = (top, bottom) => {
    const a = top[3] + bottom[3] * (1 - top[3])
    if (a === 0) return [0, 0, 0, 0]
    return [
      (top[0] * top[3] + bottom[0] * bottom[3] * (1 - top[3])) / a,
      (top[1] * top[3] + bottom[1] * bottom[3] * (1 - top[3])) / a,
      (top[2] * top[3] + bottom[2] * bottom[3] * (1 - top[3])) / a,
      a,
    ]
  }

  const luminance = ([r, g, b]) => {
    const channel = (value) => {
      const c = value / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }

  const contrast = (a, b) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (light + 0.05) / (dark + 0.05)
  }

  const show = ([r, g, b, a]) =>
    a === 1
      ? `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`
      : `rgba(${Math.round(r)} ${Math.round(g)} ${Math.round(b)} / ${a.toFixed(2)})`

  /** Everything painted behind an element, flattened down to the first
   *  opaque layer. The viewer stacks tints, so one lookup is not enough. */
  const backgroundBehind = (element) => {
    const layers = []
    for (let node = element; node !== null; node = node.parentElement) {
      const colour = rgba(getComputedStyle(node).backgroundColor)
      if (colour[3] > 0) layers.push(colour)
      if (colour[3] === 1) break
    }
    const base = rgba(getComputedStyle(document.body).backgroundColor)
    return layers.reduceRight(
      (below, above) => over(above, below),
      base[3] === 1 ? base : [255, 255, 255, 1],
    )
  }

  const visible = (element) => {
    const style = getComputedStyle(element)
    if (style.visibility === 'hidden' || style.display === 'none') return false
    if (Number(style.opacity) === 0) return false
    const rect = element.getBoundingClientRect()
    // The screen-reader-only pattern clips itself to a single pixel. It is
    // never painted, so its colours are not a contrast question.
    return rect.width > 1 && rect.height > 1
  }

  const where = (element) => {
    const parts = []
    for (let node = element; node !== null && parts.length < 3; node = node.parentElement) {
      const role = node.getAttribute('role')
      const name = String(node.className).split(' ').filter(Boolean)[0]
      parts.push(
        node.tagName.toLowerCase() + (role !== null ? `[${role}]` : name ? `.${name}` : ''),
      )
    }
    return parts.join(' < ')
  }

  const groups = new Map()
  const add = (entry) => {
    const key = `${entry.where}|${entry.foreground}|${entry.background}`
    const seen = groups.get(key)
    if (seen === undefined) groups.set(key, { ...entry, count: 1 })
    else seen.count += 1
  }

  if (mode === 'ring') return ringOn(document.activeElement)

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.textContent.trim() === '') continue
    const element = node.parentElement
    if (element === null || !visible(element)) continue
    const background = backgroundBehind(element)
    const foreground = over(rgba(getComputedStyle(element).color), background)
    add({
      where: where(element),
      foreground: show(foreground),
      background: show(background),
      ratio: contrast(foreground, background),
      sample: node.textContent.trim().slice(0, 40),
    })
  }

  return [...groups.values()]

  /**
   * The focus indicator on whatever Tab has just reached.
   *
   * Every part of it, not the first one found: shadcn draws its ring with
   * `box-shadow` and recolours the border at the same time, while the bare
   * buttons in this project rely on the browser's own outline. Reading only
   * one of the three reports a control as having no indicator when it has a
   * perfectly good one, so this takes the strongest part — if any of them
   * separates the control from its background, a reader can see it.
   */
  function ringOn(element) {
    if (element === null || element === document.body) return null
    const style = getComputedStyle(element)
    const background = backgroundBehind(element)
    const parts = []

    if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) {
      parts.push(style.outlineColor)
    }
    // A shadow with no offset, blur or spread paints nothing a reader can
    // see; Tailwind emits several such placeholder layers for every ring.
    for (const layer of splitShadows(style.boxShadow)) {
      // The colour is whatever precedes the first length. Matching a colour
      // function by name misses the one that matters: a computed colour
      // comes back as `oklab()` however it was written.
      const split = /^(.*?)\s+(-?[\d.]+px\b.*)$/.exec(layer.replace(/^inset\s+/i, ''))
      if (split === null) continue
      const extent = (split[2].match(/-?[\d.]+px/g) ?? []).reduce(
        (most, value) => Math.max(most, Math.abs(parseFloat(value))),
        0,
      )
      if (extent > 0) parts.push(split[1])
    }
    if (parseFloat(style.borderTopWidth) > 0) parts.push(style.borderTopColor)

    const painted = parts
      .map((colour) => over(rgba(colour), background))
      .filter((colour) => colour[3] > 0)
      .sort((a, b) => contrast(b, background) - contrast(a, background))[0]

    return {
      where: where(element),
      foreground: painted === undefined ? 'no indicator' : show(painted),
      background: show(background),
      ratio: painted === undefined ? 0 : contrast(painted, background),
      sample: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 40),
      count: 1,
    }
  }

  /** `box-shadow` comma-separated, without cutting a colour in half. */
  function splitShadows(value) {
    const layers = []
    let depth = 0
    let start = 0
    for (let at = 0; at < value.length; at += 1) {
      if (value[at] === '(') depth += 1
      else if (value[at] === ')') depth -= 1
      else if (value[at] === ',' && depth === 0) {
        layers.push(value.slice(start, at).trim())
        start = at + 1
      }
    }
    layers.push(value.slice(start).trim())
    return layers.filter((layer) => layer !== '' && layer !== 'none')
  }
}
