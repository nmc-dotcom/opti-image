import { useEffect, useState } from 'react'
import { useEditStore } from '@/store/useEditStore'
import { AI_INPAINTING_ENABLED } from '@/lib/features'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

// Mirrors MIGAN_MODEL in features/ai/inpainting/model.ts. Kept as plain values here so merely
// rendering this picker does not pull the inpainting module into the main bundle.
const AI_MODEL_SIZE_MB = 28
const AI_SUPPORTED = typeof WebAssembly !== 'undefined' && typeof OffscreenCanvas !== 'undefined'

/** Shared "how to reconstruct the background" choice for object removal and text replacement. */
export function InpaintMethodPicker() {
  const method = useEditStore((s) => s.method)
  const setMethod = useEditStore((s) => s.setMethod)
  const aiBackend = useEditStore((s) => s.aiBackend)
  const [cached, setCached] = useState<boolean | null>(null)

  useEffect(() => {
    // Inline flag check so the model module is dropped from builds with AI inpainting disabled.
    if (import.meta.env.VITE_ENABLE_AI_INPAINTING !== 'true' || method !== 'ai') return
    let cancelled = false
    import('@/features/ai/inpainting/model')
      .then(({ isModelCached }) => isModelCached())
      .then((value) => {
        if (!cancelled) setCached(value)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [method, aiBackend])

  // AI inpainting is disabled in this build: only the in-browser classic algorithms exist.
  if (!AI_INPAINTING_ENABLED) {
    return (
      <p className="text-[11px] text-muted-foreground">
        배경 복원: 주변 질감을 이용하는 브라우저 알고리즘으로 처리하며 추가 다운로드가 없습니다.
        단순한 배경·작은 영역에 적합합니다.
      </p>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label>배경 복원 방식</Label>
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          size="sm"
          variant={method === 'classic' ? 'default' : 'outline'}
          onClick={() => setMethod('classic')}
        >
          기본 (빠름)
        </Button>
        <Button
          size="sm"
          variant={method === 'ai' ? 'default' : 'outline'}
          onClick={() => setMethod('ai')}
          disabled={!AI_SUPPORTED}
          title={AI_SUPPORTED ? undefined : '이 브라우저는 WebAssembly를 지원하지 않습니다.'}
        >
          AI 인페인팅
        </Button>
      </div>
      {method === 'classic' ? (
        <p className="text-[11px] text-muted-foreground">
          주변 질감을 복제하는 브라우저 알고리즘입니다. 단순한 배경·작은 영역에 적합하며 추가
          다운로드가 없습니다.
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          MI-GAN 모델로 복잡한 배경을 생성합니다.{' '}
          {cached
            ? '모델이 브라우저에 저장되어 있습니다.'
            : `처음 실행 시 모델(약 ${AI_MODEL_SIZE_MB}MB)을 내려받아 브라우저에 저장합니다.`}{' '}
          이미지는 기기 밖으로 전송되지 않습니다.
          {aiBackend && ` · 실행: ${aiBackend === 'webgpu' ? 'WebGPU' : 'WASM (CPU)'}`}
        </p>
      )}
    </div>
  )
}
