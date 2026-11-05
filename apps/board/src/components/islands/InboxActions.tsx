import ActionButton from "@/components/islands/ActionButton"

interface Props {
  workspace: string
  itemId: string
  status: "open" | "read" | "discarded" | string
  className?: string
}

export default function InboxActions({
  workspace,
  itemId,
  status,
  className = "flex flex-col gap-1",
}: Props) {
  if (status !== "open" && status !== "read") {
    return <span className="text-xs text-muted-foreground">Closed</span>
  }

  return (
    <div className={className}>
      {status === "open" && (
        <ActionButton
          endpoint="/api/inbox/ack"
          params={{ workspace, item: itemId }}
          label="Ack"
          variant="outline"
          noteField="note"
          noteRows={2}
        />
      )}
      <ActionButton
        endpoint="/api/inbox/discard"
        params={{ workspace, item: itemId }}
        label="Discard"
        variant="ghost"
        noteField="reason"
        noteRows={2}
      />
      <ActionButton
        endpoint="/api/inbox/promote"
        params={{ workspace, item: itemId, type: "note" }}
        label="Promote note"
        variant="ghost"
      />
    </div>
  )
}
