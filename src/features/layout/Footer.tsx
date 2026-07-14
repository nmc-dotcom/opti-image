import { Lock } from 'lucide-react'

const HOLORADO_HOME = 'https://holorado.me'
const PRIVACY_URL = 'https://holorado.me/privacy'

/**
 * Minimal app footer: maker attribution (홀로라도) and a privacy-policy link, kept slim so it
 * never crowds the editor. Mirrors the understated footer tone of the sibling OptiPDF site.
 */
export function Footer() {
  return (
    <footer className="flex shrink-0 flex-col items-center justify-between gap-1 border-t bg-background px-4 py-2 text-[11px] text-muted-foreground sm:flex-row">
      <span className="hidden items-center gap-1 sm:inline-flex">
        <Lock className="h-3 w-3" />
        모든 처리는 브라우저에서 이루어집니다
      </span>

      <div className="flex items-center gap-2">
        <span>
          <a
            href={HOLORADO_HOME}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground transition-colors hover:text-primary"
          >
            홀로라도
          </a>
          가 만든 도구입니다
        </span>
        <span aria-hidden>·</span>
        <a
          href={PRIVACY_URL}
          target="_blank"
          rel="noreferrer"
          className="transition-colors hover:text-foreground"
        >
          개인정보처리방침
        </a>
      </div>
    </footer>
  )
}
