import { Lock, Zap } from 'lucide-react'

const REPO_URL = 'https://github.com/nmc-dotcom/opti-image'

/**
 * App footer with the privacy note, tech credits, and a repository link. Kept slim so it fits
 * the fixed full-height workspace without crowding the editor.
 */
export function Footer() {
  return (
    <footer className="flex shrink-0 flex-col items-center justify-between gap-1 border-t bg-background px-4 py-2 text-[11px] text-muted-foreground sm:flex-row">
      <div className="flex items-center gap-3">
        <span className="font-medium text-foreground">OptiImage</span>
        <span>© {new Date().getFullYear()}</span>
        <span className="hidden items-center gap-1 sm:inline-flex">
          <Lock className="h-3 w-3" />
          모든 처리는 브라우저에서 · 파일은 서버로 전송되지 않습니다
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-1 md:inline-flex">
          <Zap className="h-3 w-3" />
          Canvas API · Web Workers
        </span>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium transition-colors hover:text-foreground"
        >
          GitHub
        </a>
      </div>
    </footer>
  )
}
