import { useState } from "react"
import { Button } from "@/components/ui/button"

interface ExtraField {
  param: string
  placeholder: string
}

interface Props {
  endpoint: string
  params: Record<string, string>
  label: string
  variant?: "default" | "outline" | "ghost" | "destructive"
  noteField?: "note" | "summary" | "reason" | "body"
  noteRequired?: boolean
  notePlaceholder?: string
  noteRows?: number
  extraField?: ExtraField
  confirm?: string
}

type Phase = "idle" | "prompt" | "busy" | "error"

export default function ActionButton({
  endpoint,
  params,
  label,
  variant = "outline",
  noteField,
  noteRequired = false,
  notePlaceholder,
  noteRows = 2,
  extraField,
  confirm,
}: Props) {
  const [phase, setPhase] = useState<Phase>("idle")
  const [note, setNote] = useState("")
  const [extra, setExtra] = useState("")
  const [error, setError] = useState<string | null>(null)

  async function submit(finalNote: string, finalExtra: string) {
    setPhase("busy")
    setError(null)
    const body: Record<string, string> = { ...params }
    if (noteField && finalNote) body[noteField] = finalNote
    if (extraField && finalExtra) body[extraField.param] = finalExtra
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
      }
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
        setPhase("error")
        return
      }
      window.dispatchEvent(
        new CustomEvent("board:action-complete", {
          detail: { endpoint, params, response: data },
        })
      )
      setNote("")
      setExtra("")
      setPhase("idle")
    } catch (err) {
      setError((err as Error).message)
      setPhase("error")
    }
  }

  function handleClick() {
    if (phase === "busy") return
    if (noteField || extraField) {
      setPhase("prompt")
      return
    }
    if (confirm && !window.confirm(confirm)) return
    void submit("", "")
  }

  function handleConfirm() {
    if (noteField && noteRequired && !note.trim()) {
      setError(`${noteField} is required`)
      return
    }
    void submit(note.trim(), extra.trim())
  }

  function cancel() {
    setPhase("idle")
    setNote("")
    setExtra("")
    setError(null)
  }

  if (phase === "prompt") {
    return (
      <div className="flex w-full flex-col gap-1">
        {extraField && (
          <input
            type="text"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder={extraField.placeholder}
            className="w-full rounded border border-border px-2 py-1 text-xs text-foreground focus:border-border focus:outline-none"
          />
        )}
        {noteField && (
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              notePlaceholder ??
              (noteRequired
                ? `${noteField} (required)`
                : `${noteField} (optional)`)
            }
            rows={noteRows}
            className="w-full rounded border border-border px-2 py-1 text-xs text-foreground focus:border-border focus:outline-none"
          />
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-1">
          <Button
            variant={variant}
            size="sm"
            onClick={handleConfirm}
            className="shrink-0"
          >
            {label}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={cancel}
            className="shrink-0"
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-stretch gap-1">
      <Button
        variant={variant}
        size="sm"
        onClick={handleClick}
        disabled={phase === "busy"}
        className="shrink-0"
      >
        {phase === "busy" ? "…" : label}
      </Button>
      {error && <p className="max-w-[240px] text-xs text-red-600">{error}</p>}
    </div>
  )
}
