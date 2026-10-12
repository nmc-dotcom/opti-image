/**
 * Types for pixel-level retouching (object removal / text editing). Everything here is
 * expressed in ORIGINAL SOURCE-IMAGE PIXEL coordinates, independent of how the preview is
 * scaled on screen or of the later crop/rotate/flip/resize pipeline stages.
 */

/** Rasterized selection mask. 0 = untouched, 255 = fully removed, in-between = feathered edge. */
export interface EditMask {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type MaskTool = 'brush' | 'rect' | 'lasso'
/** `add` paints selection in, `erase` restores (removes selection). */
export type MaskMode = 'add' | 'erase'
export type BrushEdge = 'hard' | 'soft'

/**
 * Selections are stored as vector strokes rather than a full-resolution bitmap: a stroke list is
 * tiny (undo = pop), stays exact at any zoom, and is only rasterized for the region actually
 * being processed — an 8000×6000 image never needs a 48MB mask buffer just to hold a selection.
 */
export interface BrushStroke {
  kind: 'brush'
  mode: MaskMode
  /** Diameter in source pixels. */
  size: number
  edge: BrushEdge
  /** Flat [x0, y0, x1, y1, ...] list in source pixels. */
  points: number[]
}

export interface RectStroke {
  kind: 'rect'
  mode: MaskMode
  x: number
  y: number
  width: number
  height: number
}

export interface LassoStroke {
  kind: 'lasso'
  mode: MaskMode
  /** Closed polygon, flat [x0, y0, x1, y1, ...] list in source pixels. */
  points: number[]
}

export type MaskStroke = BrushStroke | RectStroke | LassoStroke

/** `classic` = in-browser algorithm (no download), `ai` = MI-GAN ONNX model. */
export type InpaintMethod = 'classic' | 'ai'

/**
 * One applied removal, as recorded in `EditSettings.retouch` (and therefore in undo history).
 * Only metadata lives here; the actual pixels are held once in the edit store as a
 * `RetouchPatch` keyed by `id`, so history snapshots never duplicate image data.
 */
export interface RetouchOp {
  id: string
  kind: 'object-removal' | 'text-removal'
  method: InpaintMethod
  /** Region the patch covers, in source pixels. */
  bounds: Rect
}

/** Inpainted pixels for one RetouchOp: a PNG whose alpha is the (feathered) mask. */
export interface RetouchPatch {
  id: string
  imageId: string
  x: number
  y: number
  width: number
  height: number
  blob: Blob
  url: string
}

export interface TextLayer {
  id: string
  text: string
  /** Top-left of the layout box, in source pixels. */
  x: number
  y: number
  /** Layout box; text is aligned horizontally within it and centered vertically. */
  width: number
  height: number
  fontFamily: string
  fontSize: number
  fontWeight: 'normal' | 'bold'
  color: string
  textAlign: CanvasTextAlign
  /** Degrees, around the box center. */
  rotation: number
}

export interface OcrTextRegion {
  id: string
  text: string
  /** 0-100, as reported by Tesseract. */
  confidence: number
  bbox: Rect
}
