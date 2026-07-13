import type { RenameRule } from '@/types/image'

const EXTENSION_BY_FORMAT: Record<string, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
}

/**
 * Applies a rename pattern to a source filename.
 * Supported tokens: {name} original basename, {number} sequential index (padded),
 * {ext} output extension, {date} yyyymmdd.
 */
export function applyRenameRule(
  originalName: string,
  rule: RenameRule,
  index: number,
  format: string,
): string {
  const baseName = originalName.replace(/\.[^./\\]+$/, '')
  const ext = EXTENSION_BY_FORMAT[format] ?? format
  const number = String(rule.startIndex + index)
  const padded = number.padStart(3, '0')
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  const pattern = rule.pattern.trim() || '{name}'
  const withTokens = pattern
    .replaceAll('{name}', baseName)
    .replaceAll('{number}', padded)
    .replaceAll('{n}', number)
    .replaceAll('{date}', date)

  return `${withTokens}.${ext}`
}

export function getExtensionForFormat(format: string): string {
  return EXTENSION_BY_FORMAT[format] ?? format
}
