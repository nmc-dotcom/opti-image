import type { SourceImage } from '@/types/image'

/** Reads intrinsic dimensions from a File without keeping a decoded bitmap around. */
export function readImageDimensions(
  url: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('이미지를 불러올 수 없습니다.'))
    img.src = url
  })
}

export async function createSourceImage(file: File, id: string): Promise<SourceImage> {
  const originalUrl = URL.createObjectURL(file)
  const { width, height } = await readImageDimensions(originalUrl)

  return {
    id,
    file,
    name: file.name,
    originalUrl,
    width,
    height,
    size: file.size,
    type: file.type,
    createdAt: Date.now(),
  }
}
