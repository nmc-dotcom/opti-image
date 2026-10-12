import { useEditStore, type EditMode } from '@/store/useEditStore'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ObjectRemovalPanel } from './ObjectRemovalPanel'
import { TextEditPanel } from './TextEditPanel'

export function EditPanel() {
  const mode = useEditStore((s) => s.mode)
  const setMode = useEditStore((s) => s.setMode)

  return (
    <div className="space-y-3">
      <Tabs value={mode} onValueChange={(v) => setMode(v as EditMode)}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="remove" className="text-xs">
            물체 제거
          </TabsTrigger>
          <TabsTrigger value="text" className="text-xs">
            텍스트 수정
          </TabsTrigger>
        </TabsList>
        <TabsContent value="remove">
          <ObjectRemovalPanel />
        </TabsContent>
        <TabsContent value="text">
          <TextEditPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
