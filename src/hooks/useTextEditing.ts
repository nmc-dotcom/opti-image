import { useCallback } from 'react'
import { useImageStore } from '@/store/useImageStore'
import { useEditStore } from '@/store/useEditStore'
import { ocrPlugin } from '@/features/ai/ocr'
import type { OcrGranularity, OcrLanguage } from '@/features/ai/ocr/types'
import { fitWithin } from '@/lib/inpaintingCrop'
import { renderRetouchedRegion } from '@/lib/retouch'
import { estimateFontSize, estimateTextColors, refineTextBox } from '@/lib/textStyle'
import { FONT_OPTIONS, measureTextLayer } from '@/lib/textRendering'
import { clampRect } from '@/lib/mask'
import { runRemoval } from './useRetouch'
import { toast } from './useToast'
import type { InpaintMethod, OcrTextRegion, TextLayer } from '@/types/editing'
import type { ImageItem } from '@/types/image'

/**
 * Tesseract works best around 20-40px text; beyond this long edge an 8K photo only costs time and
 * memory, so OCR runs on a downscaled copy and boxes are mapped back to source pixels.
 */
const OCR_MAX_EDGE = 3200

function getItem(imageId: string): ImageItem {
  const item = useImageStore.getState().images.find((i) => i.id === imageId)
  if (!item) throw new Error('이미지를 찾을 수 없습니다.')
  return item
}

function currentPatches(item: ImageItem) {
  const { patches } = useEditStore.getState()
  return item.settings.retouch.map((op) => patches[op.id]).filter((p) => p !== undefined)
}

/** OCR over the current retouched image (source + applied removals, without text layers). */
export async function runOcr(
  imageId: string,
  lang: OcrLanguage,
  granularity: OcrGranularity,
): Promise<OcrTextRegion[]> {
  const edit = useEditStore.getState()
  if (edit.job) throw new Error('이미 다른 편집 작업이 진행 중입니다.')
  const item = getItem(imageId)
  const { width: srcW, height: srcH } = item.source
  const target = fitWithin(srcW, srcH, OCR_MAX_EDGE)

  const started = performance.now()
  try {
    edit.setJob({ label: 'OCR 준비 중', percent: 0 })
    const canvas = await renderRetouchedRegion(
      item.source.file,
      currentPatches(item),
      { x: 0, y: 0, width: srcW, height: srcH },
      target.width,
      target.height,
    )
    const ctx2d = canvas.getContext('2d', { willReadFrequently: true })
    const pixels = ctx2d?.getImageData(0, 0, target.width, target.height) ?? null
    const regions = await ocrPlugin.run({
      bitmap: canvas.transferToImageBitmap(),
      options: { lang, granularity },
      onProgress: (percent) =>
        useEditStore
          .getState()
          .setJob({ label: percent < 50 ? 'OCR 엔진 로딩 중' : '텍스트 인식 중', percent }),
    })
    const sx = srcW / target.width
    const sy = srcH / target.height
    const mapped = regions.map((r) => {
      const box = pixels ? refineTextBox(pixels, r.bbox) : r.bbox
      return {
        ...r,
        bbox: { x: box.x * sx, y: box.y * sy, width: box.width * sx, height: box.height * sy },
      }
    })
    useEditStore.getState().setOcrRegions(imageId, mapped)
    useImageStore
      .getState()
      .log(
        'info',
        `${item.source.name}: 텍스트 ${mapped.length}개 인식 (${Math.round(performance.now() - started)}ms)`,
      )
    return mapped
  } finally {
    useEditStore.getState().setJob(null)
  }
}

export interface TextStyleGuess {
  fontSize: number
  color: string
  background: string
}

/** Font size + colors that make replacement text look like the recognized original. */
export async function guessTextStyle(
  imageId: string,
  region: OcrTextRegion,
  fontFamily: string,
  fontWeight: TextLayer['fontWeight'],
): Promise<TextStyleGuess> {
  const item = getItem(imageId)
  const fontSize = estimateFontSize(region.text, region.bbox.height, fontFamily, fontWeight)
  const rect = clampRect(region.bbox, 2, item.source.width, item.source.height)
  if (!rect) return { fontSize, color: '#000000', background: '#ffffff' }
  const canvas = await renderRetouchedRegion(item.source.file, currentPatches(item), rect)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { fontSize, color: '#000000', background: '#ffffff' }
  const colors = estimateTextColors(ctx.getImageData(0, 0, rect.width, rect.height))
  return { fontSize, color: colors.text, background: colors.background }
}

export type TextLayerStyle = Pick<
  TextLayer,
  'fontFamily' | 'fontSize' | 'fontWeight' | 'color' | 'textAlign'
>

/**
 * Replace recognized text: erase the original glyphs (bbox mask → background reconstruction)
 * and add an editable text layer at the same place — one undo step for both.
 */
export async function replaceRegionText(
  imageId: string,
  region: OcrTextRegion,
  text: string,
  style: TextLayerStyle,
  method: InpaintMethod,
): Promise<TextLayer> {
  const { bbox } = region
  // Pad so anti-aliased glyph edges and slightly loose OCR boxes are fully covered.
  const pad = Math.max(2, Math.round(bbox.height * 0.15))
  const layer: TextLayer = {
    id: crypto.randomUUID(),
    text,
    x: bbox.x,
    y: bbox.y,
    width: bbox.width,
    height: bbox.height,
    rotation: 0,
    ...style,
  }

  await runRemoval({
    imageId,
    method,
    feather: Math.max(1, Math.round(bbox.height * 0.06)),
    kind: 'text-removal',
    strokes: [
      {
        kind: 'rect',
        mode: 'add',
        x: bbox.x - pad,
        y: bbox.y - pad,
        width: bbox.width + pad * 2,
        height: bbox.height + pad * 2,
      },
    ],
    alsoUpdate: (s) => (text.trim() ? { ...s, textLayers: [...s.textLayers, layer] } : s),
  })

  const edit = useEditStore.getState()
  edit.removeOcrRegion(imageId, region.id)
  if (text.trim()) edit.selectLayer(imageId, layer.id)
  return layer
}

/** Adds a free text layer centered on the image (not tied to any OCR region). */
export function addTextLayer(imageId: string, text = '텍스트'): TextLayer {
  const item = getItem(imageId)
  const fontSize = Math.max(16, Math.round(Math.min(item.source.width, item.source.height) / 12))
  const draft: TextLayer = {
    id: crypto.randomUUID(),
    text,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    fontFamily: FONT_OPTIONS[0].value,
    fontSize,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
    rotation: 0,
  }
  const size = measureTextLayer(draft)
  const layer: TextLayer = {
    ...draft,
    width: size.width,
    height: fontSize,
    x: (item.source.width - size.width) / 2,
    y: (item.source.height - fontSize) / 2,
  }
  const images = useImageStore.getState()
  images.updateSettings(imageId, (s) => ({ ...s, textLayers: [...s.textLayers, layer] }))
  images.commitHistory(imageId)
  useEditStore.getState().selectLayer(imageId, layer.id)
  return layer
}

/** Live update (no history entry); call `commitTextLayers` when the gesture/edit ends. */
export function updateTextLayer(imageId: string, layerId: string, patch: Partial<TextLayer>) {
  useImageStore.getState().updateSettings(imageId, (s) => ({
    ...s,
    textLayers: s.textLayers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)),
  }))
}

export function commitTextLayers(imageId: string) {
  const item = useImageStore.getState().images.find((i) => i.id === imageId)
  if (!item) return
  // Skip no-op commits (e.g. blur without changes) so undo doesn't need extra presses.
  const last = item.history[item.historyIndex]
  if (last && JSON.stringify(last.textLayers) === JSON.stringify(item.settings.textLayers)) return
  useImageStore.getState().commitHistory(imageId)
}

export function deleteTextLayer(imageId: string, layerId: string) {
  const images = useImageStore.getState()
  images.updateSettings(imageId, (s) => ({
    ...s,
    textLayers: s.textLayers.filter((l) => l.id !== layerId),
  }))
  images.commitHistory(imageId)
  useEditStore.getState().selectLayer(imageId, null)
}

function reportError(title: string, error: unknown) {
  const message = error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.'
  useImageStore.getState().log('error', message)
  toast({ variant: 'destructive', title, description: message })
}

/** React binding: OCR + replace actions that surface failures as toasts. */
export function useTextEditing() {
  const job = useEditStore((s) => s.job)

  const recognize = useCallback(
    async (imageId: string, lang: OcrLanguage, granularity: OcrGranularity) => {
      try {
        const regions = await runOcr(imageId, lang, granularity)
        toast({
          title: regions.length > 0 ? `텍스트 ${regions.length}개를 찾았습니다` : '인식된 텍스트가 없습니다',
        })
        return regions
      } catch (error) {
        reportError('텍스트 인식 실패', error)
        return null
      }
    },
    [],
  )

  const replace = useCallback(
    async (
      imageId: string,
      region: OcrTextRegion,
      text: string,
      style: TextLayerStyle,
      method: InpaintMethod,
    ) => {
      try {
        return await replaceRegionText(imageId, region, text, style, method)
      } catch (error) {
        reportError('텍스트 수정 실패', error)
        return null
      }
    },
    [],
  )

  return { job, busy: job !== null, recognize, replace }
}
