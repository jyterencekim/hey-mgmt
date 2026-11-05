import ActionButton from "@/components/islands/ActionButton"

interface Props {
  taskId: string
  status: string | null
  className?: string
}

const CLOSED_STATUSES = new Set(["done", "archived", "cancelled"])
const CLAIMABLE_STATUSES = new Set(["plan", "ready"])
const COMPLETABLE_STATUSES = new Set(["doing"])
const FAILABLE_STATUSES = new Set(["doing"])

export default function TaskActions({
  taskId,
  status,
  className = "flex flex-wrap gap-1.5",
}: Props) {
  if (status && CLOSED_STATUSES.has(status)) {
    return <span className="text-xs text-muted-foreground">Closed</span>
  }

  const canClaim = status ? CLAIMABLE_STATUSES.has(status) : false
  const canComplete = status ? COMPLETABLE_STATUSES.has(status) : false
  const canFail = status ? FAILABLE_STATUSES.has(status) : false

  if (!canClaim && !canComplete && !canFail) {
    return <span className="text-xs text-muted-foreground">No actions</span>
  }

  return (
    <div className={className}>
      {canClaim && (
        <ActionButton
          endpoint="/api/task/claim"
          params={{ task: taskId }}
          label="Claim"
          variant="outline"
        />
      )}
      {canComplete && (
        <ActionButton
          endpoint="/api/task/complete"
          params={{ task: taskId }}
          label="Complete"
          variant="outline"
        />
      )}
      {canFail && (
        <ActionButton
          endpoint="/api/task/fail"
          params={{ task: taskId }}
          label="Fail"
          variant="ghost"
          noteField="reason"
          noteRequired
          noteRows={2}
        />
      )}
    </div>
  )
}
