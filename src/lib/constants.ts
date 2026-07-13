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
  quality: 90,
  rotation: 0,
  flip: 'none',
  crop: null,
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
