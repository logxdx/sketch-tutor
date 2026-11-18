"use client"

import {
  BoxIcon,
  CheckCheckIcon,
  FileUpIcon,
  GlobeIcon,
  HandIcon,
  LineChartIcon,
  Loader2Icon,
  MousePointerClickIcon,
  PenLineIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
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
import { Button } from "@/components/ui/button"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import type { TutorUIMessage } from "@/lib/agent/types"
import type { BoardStatus } from "@/lib/board/types"
import { fromDataTransfer } from "@/lib/context/client"
import type { LibraryApi } from "@/lib/context/use-library"
import { cn } from "@/lib/utils"
import { Composer } from "./composer"
import { FilePickers, type FilePickersHandle } from "./file-pickers"
import { LibraryPanel } from "./library-panel"
import { MessageView } from "./message"
import { useTutor } from "./tutor-context"

const STARTERS = [
  { icon: <PenLineIcon />, text: "How does photosynthesis work? Draw it for me." },
  { icon: <BoxIcon />, text: "Show me a water molecule in 3D and explain why it's polar." },
  { icon: <LineChartIcon />, text: "Why does compound interest grow so fast? Let me play with it." },
  { icon: <GlobeIcon />, text: "What caused the fall of the Roman Empire? Use sources and a timeline." },
  { icon: <HandIcon />, text: "Quiz me on solving quadratic equations — I'll write on the board." },
]

function EmptyState({ onAddContext }: { onAddContext: () => void }) {
  const { send } = useTutor()
  return (
    <div className="flex min-h-full flex-col justify-center gap-6 px-2 py-8">
      <div className="space-y-2">
        <div className="inline-flex size-10 items-center justify-center rounded-2xl bg-tutor font-[cursive] text-xl font-bold text-white shadow">
          S
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-balance">Ask anything. I&apos;ll think it through on the board with you.</h2>
        <p className="text-sm text-pretty text-muted-foreground">
          I draw live while I explain, build 3D models, graphs and charts, find real sources — and I learn from{" "}
          <em>your</em> material: photos of homework, PDFs, lecture notes or a whole course folder.
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
        <button
          type="button"
          onClick={onAddContext}
          className="flex items-center gap-3 rounded-xl border border-dashed px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0"
        >
          <FileUpIcon />
          Start from your own material — a photo, a PDF, or a folder
        </button>
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

type View = "lesson" | "outline" | "library"

export function ChatPanel({
  messages,
  status,
  statusLabel,
  error,
  board,
  library,
  onStop,
  onRetry,
}: {
  messages: TutorUIMessage[]
  status: "submitted" | "streaming" | "ready" | "error"
  statusLabel: string | null
  error: Error | undefined
  board: BoardStatus
  library: LibraryApi
  onStop: () => void
  onRetry: () => void
}) {
  const { send } = useTutor()
  const [view, setView] = React.useState<View>("lesson")
  const [dragging, setDragging] = React.useState(false)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const pickers = React.useRef<FilePickersHandle>(null)
  const dragDepth = React.useRef(0)
  const busy = status === "submitted" || status === "streaming"

  useShortcut("/", () => inputRef.current?.focus(), { description: "Focus the message box" })

  const statusText = board.activity ?? (busy ? (statusLabel ?? "Thinking…") : null)

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const { files, folders } = await fromDataTransfer(e.dataTransfer)
    if (folders.length) {
      for (const folder of folders) library.addFolder(folder, files.filter((f) => f.path.startsWith(`${folder}/`)))
      const loose = files.filter((f) => !folders.some((d) => f.path.startsWith(`${d}/`)))
      if (loose.length) library.addFiles(loose.map((f) => f.file))
    } else if (files.length) {
      library.addFiles(files.map((f) => f.file))
    }
    if (view === "outline") setView("lesson")
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col bg-background"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return
        dragDepth.current++
        setDragging(true)
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (!dragDepth.current) setDragging(false)
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault()
      }}
      onDrop={onDrop}
    >
      <FilePickers library={library} ref={pickers} />
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
        <Segmented
          label="Panel view"
          size="sm"
          value={view}
          onValueChange={setView}
          items={[
            { value: "lesson", label: "Lesson" },
            { value: "outline", label: `Outline${board.steps.length ? ` · ${board.steps.length}` : ""}` },
            { value: "library", label: `Library${library.docs.length ? ` · ${library.docs.length}` : ""}` },
          ]}
        />
        {board.yourTurn ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
            <HandIcon className="size-3" aria-hidden /> Your turn
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1">
        {view === "outline" ? (
          <div className="h-full overflow-y-auto">
            <Outline board={board} />
          </div>
        ) : view === "library" ? (
          <LibraryPanel
            library={library}
            onPickFiles={() => pickers.current?.files()}
            onPickFolder={() => pickers.current?.folder()}
          />
        ) : messages.length === 0 ? (
          <div className="mx-auto h-full max-w-xl overflow-y-auto px-4">
            <EmptyState onAddContext={() => pickers.current?.files()} />
          </div>
        ) : (
          <MessageScrollerProvider autoScroll>
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent className="mx-auto max-w-2xl px-4 py-5" aria-busy={status === "streaming"}>
                  {messages.map((m, i) => (
                    <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === "user"}>
                      <MessageView message={m} isLast={i === messages.length - 1} busy={busy} />
                    </MessageScrollerItem>
                  ))}
                  {statusText ? (
                    <MessageScrollerItem messageId="status">
                      <Marker aria-live="polite" className="pl-10">
                        <MarkerIcon>
                          <Loader2Icon className="animate-spin text-tutor" />
                        </MarkerIcon>
                        <MarkerContent className="shimmer">{statusText}</MarkerContent>
                      </Marker>
                    </MessageScrollerItem>
                  ) : null}
                  {error ? (
                    <MessageScrollerItem messageId="error">
                      <Marker className="pl-10 text-destructive">
                        <MarkerIcon>
                          <TriangleAlertIcon />
                        </MarkerIcon>
                        <MarkerContent className="line-clamp-3">{error.message}</MarkerContent>
                        <Button variant="ghost" size="xs" onClick={onRetry} className="ml-auto shrink-0">
                          <RotateCcwIcon /> Retry
                        </Button>
                      </Marker>
                    </MessageScrollerItem>
                  ) : null}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
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
              <Button
                size="xs"
                className="rounded-full"
                disabled={busy}
                onClick={() => send("[check] I'm done — please check my work on the board.", "check")}
              >
                <CheckCheckIcon /> Check my work
              </Button>
            ) : null}
          </div>
        ) : null}
        <Composer
          library={library}
          busy={busy}
          inputRef={inputRef}
          pickers={pickers}
          placeholder={
            board.yourTurn ? "Tell Sketch what you did, or ask for a hint…" : "Ask anything — or draw, attach, and ask about it"
          }
          onSubmit={(text) => {
            const extras = library.takeDrafts()
            const fallback = extras.attachments.length || extras.files.length ? "Here's my material — help me with it." : ""
            send(text || fallback, "chat", extras)
            setView("lesson")
          }}
          onStop={onStop}
          onOpenLibrary={() => setView("library")}
        />
      </div>

      {/* Drop zone for files and whole folders. */}
      <div
        aria-hidden={!dragging}
        className={cn(
          "pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary bg-background/90 text-sm backdrop-blur transition-opacity",
          dragging ? "opacity-100" : "opacity-0"
        )}
      >
        <FileUpIcon className="size-6 text-primary" />
        <span className="font-medium">Drop files or folders</span>
        <span className="text-xs text-muted-foreground">Images go with your message · PDFs, notes and code go to your library</span>
      </div>
    </div>
  )
}
