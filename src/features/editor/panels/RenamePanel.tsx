import { useImageStore } from '@/store/useImageStore'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { applyRenameRule } from '@/lib/fileNaming'

export function RenamePanel() {
  const activeId = useImageStore((s) => s.activeId)
  const item = useImageStore((s) => s.images.find((i) => i.id === activeId))
  const renameRule = useImageStore((s) => s.renameRule)
  const setRenameRule = useImageStore((s) => s.setRenameRule)

  const preview = item
    ? applyRenameRule(item.source.name, renameRule, 0, item.settings.format)
    : ''

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="rename-pattern">파일명 규칙</Label>
        <Input
          id="rename-pattern"
          value={renameRule.pattern}
          onChange={(e) => setRenameRule({ ...renameRule, pattern: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          사용 가능 토큰: {'{name}'} 원본명, {'{number}'} 순번(3자리), {'{date}'} 날짜
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="rename-start">시작 번호</Label>
        <Input
          id="rename-start"
          type="number"
          min={0}
          value={renameRule.startIndex}
          onChange={(e) =>
            setRenameRule({ ...renameRule, startIndex: Number(e.target.value) })
          }
        />
      </div>

      {item && (
        <div className="rounded-md border bg-muted/40 p-2 text-xs">
          <span className="text-muted-foreground">미리보기: </span>
          <span className="font-medium">{preview}</span>
        </div>
      )}
    </div>
  )
}
