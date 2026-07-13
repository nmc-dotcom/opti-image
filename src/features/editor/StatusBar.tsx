import { ChevronUp, ChevronDown, CheckCircle2, Info, XCircle } from 'lucide-react'
import { useImageStore } from '@/store/useImageStore'
import { useUiStore } from '@/store/useUiStore'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

export function StatusBar() {
  const logs = useImageStore((s) => s.logs)
  const batchProgress = useImageStore((s) => s.batchProgress)
  const logPanelOpen = useUiStore((s) => s.logPanelOpen)
  const toggleLogPanel = useUiStore((s) => s.toggleLogPanel)

  const lastLog = logs[logs.length - 1]

  return (
    <footer className="shrink-0 border-t bg-background">
      {batchProgress && (
        <div className="flex items-center gap-2 border-b px-4 py-1.5 text-xs">
          <span className="shrink-0 text-muted-foreground">
            처리 중 {batchProgress.current}/{batchProgress.total}
          </span>
          <Progress
            className="h-1.5 flex-1"
            value={(batchProgress.current / Math.max(batchProgress.total, 1)) * 100}
          />
        </div>
      )}

      <button
        className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent/50"
        onClick={toggleLogPanel}
      >
        {lastLog ? <LogIcon level={lastLog.level} /> : <Info className="h-3.5 w-3.5" />}
        <span className="truncate">
          {lastLog?.message ?? '작업 로그가 여기에 표시됩니다.'}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {logs.length}건{' '}
          {logPanelOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {logPanelOpen && (
        <div className="scrollbar-thin max-h-40 overflow-y-auto border-t px-4 py-2">
          {logs.length === 0 && (
            <p className="text-xs text-muted-foreground">로그가 없습니다.</p>
          )}
          <ul className="space-y-1">
            {[...logs].reverse().map((entry) => (
              <li key={entry.id} className="flex items-start gap-2 text-xs">
                <LogIcon level={entry.level} />
                <span className="text-muted-foreground">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                <span>{entry.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </footer>
  )
}

function LogIcon({ level }: { level: string }) {
  if (level === 'success')
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
  if (level === 'error')
    return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
  return <Info className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground')} />
}
