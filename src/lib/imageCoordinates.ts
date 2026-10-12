export interface ContentRect {
  offsetX: number
  offsetY: number
  width: number
  height: number
}

/**
 * Computes the actual displayed image content box inside the <img> element. Because the image
 * is rendered with `object-contain`, its content can be letterboxed (centered with padding)
 * when the element's box aspect ratio differs from the image's. Overlay coordinates must be
 * mapped against this content box, not the element box, or they land on the wrong region.
 */
export function getContentRect(
  el: HTMLImageElement,
  elWidth: number,
  elHeight: number,
): ContentRect {
  const { naturalWidth: nw, naturalHeight: nh } = el
  if (!nw || !nh) return { offsetX: 0, offsetY: 0, width: elWidth, height: elHeight }

  const elRatio = elWidth / elHeight
  const imgRatio = nw / nh

  let width: number
  let height: number
  if (elRatio > imgRatio) {
    // Element is wider than the image → padding on left/right.
    height = elHeight
    width = elHeight * imgRatio
  } else {
    // Element is taller than the image → padding on top/bottom.
    width = elWidth
    height = elWidth / imgRatio
  }
  return { offsetX: (elWidth - width) / 2, offsetY: (elHeight - height) / 2, width, height }
}

/**
 * Screen (client) coordinates → original source-image pixel coordinates, going through the
 * rendered element box and its letterboxed content box. Not clamped: brush strokes may
 * legitimately start just outside the image edge.
 */
export function clientToImagePoint(
  el: HTMLImageElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = el.getBoundingClientRect()
  const content = getContentRect(el, rect.width, rect.height)
  const scale = el.naturalWidth / content.width
  return {
    x: (clientX - rect.left - content.offsetX) * scale,
    y: (clientY - rect.top - content.offsetY) * scale,
  }
}

/** Source pixels per displayed CSS pixel for the given <img>. */
export function getImageScale(el: HTMLImageElement): number {
  const rect = el.getBoundingClientRect()
  const content = getContentRect(el, rect.width, rect.height)
  return content.width > 0 ? el.naturalWidth / content.width : 1
}
