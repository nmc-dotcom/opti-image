import type { EditJob } from '@/store/useEditStore'

/** Progress card in the same style as the background-removal progress in the AI panel. */
export function JobProgress({ job }: { job: EditJob }) {
  return (
    <div className="space-y-1 rounded-md border p-2">
      <p className="text-xs font-medium">
        {job.label}
        {job.percent !== null && ` ${job.percent}%`}
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {job.percent === null ? (
          <div className="h-full w-1/3 animate-pulse bg-primary" />
        ) : (
          <div className="h-full bg-primary transition-all" style={{ width: `${job.percent}%` }} />
        )}
      </div>
    </div>
  )
}
