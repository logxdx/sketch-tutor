"use client"

import {
  ArrowUpIcon,
  BoxIcon,
  CheckCheckIcon,
  GlobeIcon,
  HandIcon,
  LineChartIcon,
  MousePointerClickIcon,
  PenLineIcon,
  RotateCcwIcon,
  SquareIcon,
} from "lucide-react"
import * as React from "react"
import { useShortcut } from "@ui-sdk/react/shortcuts"
import {
  Timeline,
  TimelineDescription,
  TimelineItem,
  TimelineMarker,
  TimelineTitle,
} from "@ui-sdk/react/timeline"

import { Segmented } from "@/components/ui-sdk/controls"
import type { TutorUIMessage } from "@/lib/agent/types"
import type { BoardStatus } from "@/lib/board/types"
import { cn } from "@/lib/utils"
import { MessageView } from "./message"
import { useTutor } from "./tutor-context"

const STARTERS = [
  { icon: <PenLineIcon />, text: "How does photosynthesis work? Draw it for me." },
  { icon: <BoxIcon />, text: "Show me a water molecule in 3D and explain why it's polar." },
  { icon: <LineChartIcon />, text: "Why does compound interest grow so fast? Let me play with it." },
  { icon: <GlobeIcon />, text: "What caused the fall of the Roman Empire? Use sources and a timeline." },
  { icon: <HandIcon />, text: "Quiz me on solving quadratic equations — I'll write on the board." },
  { icon: <MousePointerClickIcon />, text: "Explain binary search step by step on the board." },
]

function EmptyState() {
  const { send } = useTutor()
  return (
    <div className="flex h-full flex-col justify-center gap-6 px-2 py-8">
      <div className="space-y-2">
        <div className="inline-flex size-10 items-center justify-center rounded-2xl bg-tutor font-[cursive] text-xl font-bold text-white shadow">
          S
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-balance">Ask anything. I&apos;ll think it through on the board with you.</h2>
        <p className="text-sm text-pretty text-muted-foreground">
          I draw live while I explain, build 3D models, graphs and charts, find real sources and images — and I watch
          what <em>you</em> draw too. Select something on the board and ask about it.
        </p>
      </div>
      <div className="grid gap-2">
        {STARTERS.map((s) => (
          <button
            key={s.text}
            type="button"
            onClick={() => send(s.text)}
            className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-primary"
          >
            {s.icon}
            {s.text}
          </button>
        ))}
      </div>
    </div>
  )
}

function Outline({ board }: { board: BoardStatus }) {
  const { board: controller } = useTutor()
  if (!board.steps.length) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        Every drawing, graph and task Sketch puts on the board shows up here. Click one to jump to it.
      </p>
    )
  }
  const last = board.steps.length - 1
  return (
    <Timeline aria-label="Lesson outline" className="p-4">
      {board.steps.map((s, i) => (
        <TimelineItem
          key={s.id}
          value={s.id}
          status={i < last ? "complete" : "current"}
          className="group relative grid cursor-pointer grid-cols-[1rem_1fr] gap-x-3 rounded-md pb-5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => controller?.focusStep(s.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") controller?.focusStep(s.id)
          }}
        >
          <TimelineMarker className="col-start-1 row-start-1 mt-1 size-3 rounded-full border-2 border-primary bg-background data-complete:bg-primary data-current:ring-4 data-current:ring-primary/20" />
          <span aria-hidden className="absolute top-5 bottom-0 left-[5px] w-px bg-border group-last:hidden" />
          <TimelineTitle className="col-start-2 text-sm font-medium group-hover:text-primary">{s.title}</TimelineTitle>
          <TimelineDescription className="col-start-2 text-xs text-muted-foreground capitalize">
            {s.kind} · {new Date(s.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </TimelineDescription>
        </TimelineItem>
      ))}
    </Timeline>
  )
}

export function ChatPanel({
  messages,
  status,
  statusLabel,
  error,
  board,
  onStop,
  onRetry,
}: {
  messages: TutorUIMessage[]
  status: "submitted" | "streaming" | "ready" | "error"
  statusLabel: string | null
  error: Error | undefined
  board: BoardStatus
  onStop: () => void
  onRetry: () => void
}) {
  const { send } = useTutor()
  const [view, setView] = React.useState<"lesson" | "outline">("lesson")
  const [input, setInput] = React.useState("")
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const stick = React.useRef(true)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const busy = status === "submitted" || status === "streaming"

  React.useEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight })
  }, [messages, statusLabel, board.activity])

  const submit = () => {
    const text = input.trim()
    if (!text || busy) return
    send(text)
    setInput("")
    stick.current = true
  }

  useShortcut("/", () => inputRef.current?.focus(), { description: "Focus the message box" })

  const statusText = board.activity ?? (busy ? (statusLabel ?? "Thinking…") : null)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
        <Segmented
          label="Panel view"
          size="sm"
          value={view}
          onValueChange={setView}
          items={[
            { value: "lesson", label: "Lesson" },
            { value: "outline", label: `Outline${board.steps.length ? ` · ${board.steps.length}` : ""}` },
          ]}
        />
        {board.yourTurn ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
            <HandIcon className="size-3" aria-hidden /> Your turn
          </span>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {view === "outline" ? (
          <Outline board={board} />
        ) : messages.length === 0 ? (
          <div className="mx-auto h-full max-w-xl px-4">
            <EmptyState />
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-5 px-4 py-5">
            {messages.map((m, i) => (
              <MessageView key={m.id} message={m} isLast={i === messages.length - 1} streaming={busy} />
            ))}
            {statusText ? (
              <div className="flex items-center gap-2 pl-9 text-xs text-muted-foreground" aria-live="polite">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-tutor opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-tutor" />
                </span>
                {statusText}
              </div>
            ) : null}
            {error ? (
              <div className="ml-9 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <p className="font-medium text-destructive">Something went wrong</p>
                <p className="mt-1 line-clamp-4 text-xs text-muted-foreground">{error.message}</p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <RotateCcwIcon className="size-3" aria-hidden /> Try again
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t bg-background p-3">
        {board.selection.length || board.yourTurn ? (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {board.selection.length ? (
              <span className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
                <MousePointerClickIcon className="size-3" aria-hidden />
                Asking about {board.selection.length} selected item{board.selection.length > 1 ? "s" : ""}
              </span>
            ) : null}
            {board.yourTurn ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => send("[check] I'm done — please check my work on the board.", "check")}
                className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
              >
                <CheckCheckIcon className="size-3" aria-hidden /> Check my work
              </button>
            ) : null}
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="flex items-end gap-2 rounded-2xl border bg-card p-1.5 shadow-xs focus-within:ring-2 focus-within:ring-ring/40"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            rows={1}
            placeholder={board.yourTurn ? "Tell Sketch what you did, or ask for a hint…" : "Ask anything — or draw and ask about it"}
            aria-label="Message Sketch"
            className="field-sizing-content max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background"
            >
              <SquareIcon className="size-3.5 fill-current" aria-hidden />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              disabled={!input.trim()}
              className={cn(
                "inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
              )}
            >
              <ArrowUpIcon className="size-4" aria-hidden />
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
