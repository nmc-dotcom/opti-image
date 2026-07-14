import type { EditSettings } from '@/types/image'

export const DEFAULT_EDIT_SETTINGS: EditSettings = {
  resize: {
    mode: 'none',
    width: 0,
    height: 0,
    longEdge: 0,
    percentage: 100,
    keepAspectRatio: true,
  },
  format: 'png',
  quality: 82,
  rotation: 0,
  flip: 'none',
  crop: null,
}

/** Long edge (px) above which "웹 최적화" downsizes an image. 2048px covers most web/sharing needs. */
export const WEB_OPTIMIZE_LONG_EDGE = 2048

/**
 * One-click "web optimize" preset: convert to JPG at a sensible quality and cap the long edge,
 * which reliably shrinks large photos (e.g. 24MP camera JPEGs) well below their original size.
 */
export function webOptimizePreset(settings: EditSettings): EditSettings {
  return {
    ...settings,
    format: 'jpeg',
    quality: 80,
    resize: {
      ...settings.resize,
      mode: 'longEdge',
      longEdge: WEB_OPTIMIZE_LONG_EDGE,
      keepAspectRatio: true,
    },
  }
}

export const ACCEPTED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/svg+xml',
]

export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024

export const MAX_HISTORY_LENGTH = 50
