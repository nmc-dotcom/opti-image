import { ShieldCheck } from 'lucide-react'

/**
 * Slim tagline shown under the top bar. Communicates what the tool does and its privacy-first
 * promise. Hidden on very small screens to preserve vertical workspace.
 */
export function IntroBar() {
  return (
    <div className="hidden shrink-0 items-center justify-center gap-2 border-b bg-muted/30 px-4 py-1.5 text-center text-xs text-muted-foreground sm:flex">
      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span>
        브라우저에서 끝내는 이미지 툴킷 — 리사이즈 · 포맷 변환 · 압축 · 자르기를{' '}
        <span className="font-medium text-foreground">서버 업로드 없이</span> 안전하게 처리합니다.
      </span>
    </div>
  )
}
