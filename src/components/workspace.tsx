"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai"
import {
  EyeIcon,
  GaugeIcon,
  GraduationCapIcon,
  HandIcon,
  LayoutGridIcon,
  MessageCircleQuestionIcon,
  MoonIcon,
  PlayIcon,
  PlusIcon,
  SquareIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react"
import dynamic from "next/dynamic"
import * as React from "react"
import { Resizable, ResizableHandle, ResizablePanel } from "@ui-sdk/react/resizable"
import { useShortcut } from "@ui-sdk/react/shortcuts"
import { toast } from "@ui-sdk/react/toast"

import { ChatPanel } from "@/components/chat/chat-panel"
import { TutorContext, type TutorActions } from "@/components/chat/tutor-context"
import { CommandPalette, type PaletteAction } from "@/components/ui-sdk/command-palette"
import { IconButton, PickList, Segmented, Toggle } from "@/components/ui-sdk/controls"
import { MODES, SUBJECTS, type Mode, type Subject, type TutorUIMessage } from "@/lib/agent/types"
import type { BoardController, ToolResult } from "@/lib/board/controller"
import { playDemo } from "@/lib/board/demo"
import type { DrawSpeed } from "@/lib/board/types"
import { useBoardStatus } from "@/lib/board/use-board"

const Whiteboard = dynamic(() => import("@/components/board/whiteboard"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Unrolling the whiteboard…</div>
  ),
})

/** Board tools the browser executes (quiz waits for a click instead). */
const BOARD_TOOLS = new Set(["draw", "plot", "annotate", "point_at", "erase", "ask_student"])
const MAX_AUTO_TURNS = 12
const WATCH_IDLE_MS = 3500

function useIsNarrow() {
  const [narrow, setNarrow] = React.useState(false)
  React.useEffect(() => {
    const mq = matchMedia("(max-width: 767px)")
    const update = () => setNarrow(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])
  return narrow
}

/** Theme lives on <html class="dark"> (set before paint by the layout script). */
function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}

function useTheme() {
  const theme = React.useSyncExternalStore(
    subscribeTheme,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => "light" as const
  )
  const toggle = React.useCallback(() => {
    const next = document.documentElement.classList.contains("dark") ? "light" : "dark"
    document.documentElement.classList.toggle("dark", next === "dark")
    try {
      localStorage.setItem("sketch-theme", next)
    } catch {}
  }, [])
  return [theme, toggle] as const
}

export function Workspace() {
  const [board, setBoard] = React.useState<BoardController | null>(null)
  const boardRef = React.useRef<BoardController | null>(null)
  const boardStatus = useBoardStatus(board)
  const [subject, setSubject] = React.useState<Subject>("general")
  const [mode, setMode] = React.useState<Mode>("explain")
  const [watch, setWatch] = React.useState(false)
  const [statusLabel, setStatusLabel] = React.useState<string | null>(null)
  const [theme, toggleTheme] = useTheme()
  const narrow = useIsNarrow()

  const settings = React.useRef({ subject, mode })
  React.useEffect(() => {
    settings.current = { subject, mode }
  }, [subject, mode])
  const pendingBoardText = React.useRef<string | null>(null)
  const autoTurns = React.useRef(0)

  // The body getter runs per request (not during render), so reading refs there is intended.
  const transport = React.useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs
      new DefaultChatTransport<TutorUIMessage>({
        api: "/api/chat",
        body: () => {
          const text = pendingBoardText.current ?? boardRef.current?.describe() ?? null
          pendingBoardText.current = null
          return { ...settings.current, board: text }
        },
      }),
    []
  )

  const { messages, sendMessage, addToolOutput, status, stop, error, regenerate, setMessages } =
    useChat<TutorUIMessage>({
      transport,
      onData: (part) => {
        if (part.type === "data-status") setStatusLabel(part.data.label)
      },
      onFinish: () => setStatusLabel(null),
      onError: (e) => {
        setStatusLabel(null)
        toast.error("Sketch hit a problem", { description: e.message.slice(0, 200) })
      },
      // Whiteboard tools run here, animated on the canvas; results go back to the agent.
      onToolCall: ({ toolCall }) => {
        if (toolCall.dynamic || !BOARD_TOOLS.has(toolCall.toolName)) return
        const b = boardRef.current
        const name = toolCall.toolName as "draw"
        const id = toolCall.toolCallId
        if (!b) {
          addToolOutput({ tool: name, toolCallId: id, state: "output-error", errorText: "The whiteboard is not ready yet." })
          return
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const input = toolCall.input as any
        let run: Promise<ToolResult>
        switch (toolCall.toolName) {
          case "draw":
            run = b.draw(input, id)
            break
          case "plot":
            run = b.plot(input, id)
            break
          case "annotate":
            run = b.annotate(input, id)
            break
          case "point_at":
            run = b.pointAt(input)
            break
          case "erase":
            run = b.erase(input)
            break
          default:
            run = b.askStudent(input, id)
        }
        run
          .then((output) => addToolOutput({ tool: name, toolCallId: id, output: output as never }))
          .catch((e: Error) =>
            addToolOutput({ tool: name, toolCallId: id, state: "output-error", errorText: e.message })
          )
      },
      // Continue the agent after browser tools finish — but wait when the student has the pen.
      sendAutomaticallyWhen: ({ messages }) => {
        if (!lastAssistantMessageIsCompleteWithToolCalls({ messages })) return false
        const parts = messages.at(-1)?.parts ?? []
        const stepStart = parts.findLastIndex((p) => p.type === "step-start")
        const step = parts.slice(stepStart + 1)
        if (step.some((p) => p.type === "tool-ask_student")) return false
        if (autoTurns.current >= MAX_AUTO_TURNS) return false
        autoTurns.current++
        return true
      },
    })

  const busy = status === "submitted" || status === "streaming"
  const busyRef = React.useRef(busy)
  React.useEffect(() => {
    busyRef.current = busy
  }, [busy])

  const send = React.useCallback<TutorActions["send"]>(
    async (text, kind = "chat") => {
      const b = boardRef.current
      const s = b?.getStatus()
      let files: { type: "file"; mediaType: string; url: string; filename: string }[] | undefined
      // Share a picture only when it adds something the text description can't.
      if (b && s && !s.isEmpty && (kind !== "chat" || s.studentDirty || s.yourTurn || s.selection.length)) {
        try {
          const url = await b.snapshot()
          if (url) files = [{ type: "file", mediaType: "image/jpeg", url, filename: "board.jpg" }]
        } catch (e) {
          console.warn("snapshot failed", e)
        }
      }
      pendingBoardText.current = b?.describe() ?? null
      autoTurns.current = 0
      setStatusLabel(null)
      sendMessage({ text, files, metadata: { kind } })
      b?.markSeen({ closeTask: kind === "check" })
    },
    [sendMessage]
  )

  const answerQuiz = React.useCallback<TutorActions["answerQuiz"]>(
    (toolCallId, output) => {
      autoTurns.current = 0
      addToolOutput({ tool: "quiz", toolCallId, output: output as never })
    },
    [addToolOutput]
  )

  const stopAll = React.useCallback(() => {
    stop()
    boardRef.current?.cancel()
    setStatusLabel(null)
  }, [stop])

  // Watch mode: when the student pauses while drawing, let the tutor take a look.
  React.useEffect(() => {
    if (!watch) return
    const id = setInterval(() => {
      const b = boardRef.current
      if (!b || busyRef.current) return
      const s = b.getStatus()
      if (s.studentDirty && !s.activity && !s.isEmpty && !b.isDrawing() && Date.now() - s.lastStudentActivity > WATCH_IDLE_MS) {
        send("[watching] I just paused while drawing on the board.", "watch")
      }
    }, 1000)
    return () => clearInterval(id)
  }, [watch, send])

  useShortcut("escape", () => busy && stopAll(), { description: "Stop the tutor", when: () => busy })

  const newLesson = React.useCallback(() => {
    stopAll()
    setMessages([])
    board?.clearBoard()
    toast("New lesson", { description: "Fresh board, fresh conversation." })
  }, [board, setMessages, stopAll])

  const setSpeed = (speed: DrawSpeed) => {
    board?.setSpeed(speed)
    toast(`Drawing speed: ${speed}`)
  }

  const actions: PaletteAction[] = [
    { id: "new", group: "Lesson", label: "New lesson", icon: <PlusIcon />, shortcut: "mod+shift+o", run: newLesson },
    {
      id: "explain-selection",
      group: "Lesson",
      label: "Explain what I selected",
      icon: <MessageCircleQuestionIcon />,
      run: () => send("Explain what I selected on the board."),
    },
    {
      id: "check",
      group: "Lesson",
      label: "Check my work on the board",
      icon: <HandIcon />,
      run: () => send("[check] Please check my work on the board.", "check"),
    },
    {
      id: "watch",
      group: "Lesson",
      label: watch ? "Stop watching me draw" : "Watch me draw (live feedback)",
      icon: <EyeIcon />,
      run: () => setWatch((w) => !w),
    },
    { id: "demo", group: "Lesson", label: "Play a demo lesson (no AI)", icon: <PlayIcon />, keywords: ["test", "try"], run: () => runDemo() },
    ...MODES.map((m) => ({
      id: `mode-${m.value}`,
      group: "Mode",
      label: `${m.label} — ${m.hint}`,
      icon: <GraduationCapIcon />,
      run: () => setMode(m.value),
    })),
    ...SUBJECTS.map((s) => ({
      id: `subject-${s.value}`,
      group: "Subject",
      label: s.label,
      icon: <LayoutGridIcon />,
      run: () => setSubject(s.value),
    })),
    ...(["relaxed", "normal", "fast", "instant"] as DrawSpeed[]).map((sp) => ({
      id: `speed-${sp}`,
      group: "Board",
      label: `Drawing speed: ${sp}${boardStatus.speed === sp ? " ✓" : ""}`,
      icon: <GaugeIcon />,
      run: () => setSpeed(sp),
    })),
    { id: "fit", group: "Board", label: "Zoom to fit everything", icon: <LayoutGridIcon />, run: () => board?.focusAll() },
    { id: "clear", group: "Board", label: "Clear the board", icon: <Trash2Icon />, run: () => board?.clearBoard() },
    { id: "theme", group: "Appearance", label: theme === "dark" ? "Light theme" : "Dark theme", icon: theme === "dark" ? <SunIcon /> : <MoonIcon />, run: toggleTheme },
  ]

  async function runDemo() {
    const b = board
    if (!b) return
    try {
      await playDemo(b, (text) => toast(text, { duration: 3500 }))
    } catch (e) {
      if (!(e as Error).message.startsWith("Stopped")) toast.error("Demo failed", { description: (e as Error).message })
    }
  }

  const ctx = React.useMemo<TutorActions>(() => ({ board, busy, send, answerQuiz }), [board, busy, send, answerQuiz])

  const boardPane = (
    <div className="relative h-full min-h-0 overflow-hidden bg-background">
      <Whiteboard
        theme={theme}
        onReady={(c) => {
          boardRef.current = c
          setBoard(c)
        }}
      />
      {/* Live status of what the tutor is doing on the board. */}
      {boardStatus.activity ? (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-background/90 py-1 pr-1 pl-3 text-xs shadow-md backdrop-blur">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-tutor opacity-70" />
              <span className="relative inline-flex size-2 rounded-full bg-tutor" />
            </span>
            <span className="max-w-[50vw] truncate">{boardStatus.activity}</span>
            <button
              type="button"
              onClick={stopAll}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium hover:bg-accent"
            >
              <SquareIcon className="size-2.5 fill-current" aria-hidden /> Stop
            </button>
          </div>
        </div>
      ) : null}
      {boardStatus.yourTurn && !boardStatus.activity ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 z-10 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-xl items-center gap-3 rounded-2xl border border-primary/30 bg-background/95 p-2 pl-4 text-sm shadow-lg backdrop-blur">
            <HandIcon className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-medium">Your turn: </span>
              {boardStatus.yourTurn.task}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => send("[check] I'm done — please check my work on the board.", "check")}
              className="shrink-0 rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              Check my work
            </button>
          </div>
        </div>
      ) : null}
      {boardStatus.selection.length && !busy && !boardStatus.yourTurn ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 z-10 flex justify-center">
          <button
            type="button"
            onClick={() => send("Explain what I selected on the board.")}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg"
          >
            <MessageCircleQuestionIcon className="size-3.5" aria-hidden /> Ask Sketch about this
          </button>
        </div>
      ) : null}
    </div>
  )

  const chatPane = (
    <ChatPanel
      messages={messages}
      status={status}
      statusLabel={statusLabel}
      error={error}
      board={boardStatus}
      onStop={stopAll}
      onRetry={() => regenerate()}
    />
  )

  return (
    <TutorContext.Provider value={ctx}>
      <div className="flex h-dvh flex-col">
        <header className="flex h-13 shrink-0 items-center gap-2 border-b bg-background px-3">
          <div className="flex items-center gap-2 pr-1">
            <div className="flex size-7 items-center justify-center rounded-lg bg-tutor font-[cursive] text-base font-bold text-white shadow-sm">
              S
            </div>
            <span className="hidden font-semibold tracking-tight sm:inline">Sketch</span>
          </div>
          <PickList label="Subject" items={SUBJECTS} value={subject} onValueChange={setSubject} className="max-w-40" />
          <Segmented
            label="Teaching mode"
            items={MODES}
            value={mode}
            onValueChange={setMode}
            className="hidden md:inline-flex"
          />
          <div className="ml-auto flex items-center gap-1.5">
            <Toggle checked={watch} onCheckedChange={setWatch} className="hidden pr-2 text-muted-foreground lg:inline-flex">
              Watch me draw
            </Toggle>
            <CommandPalette actions={actions} />
            <IconButton label={theme === "dark" ? "Light theme" : "Dark theme"} onClick={toggleTheme}>
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </IconButton>
            <IconButton label="New lesson" onClick={newLesson}>
              <PlusIcon />
            </IconButton>
          </div>
        </header>
        <Resizable
          key={narrow ? "v" : "h"}
          orientation={narrow ? "vertical" : "horizontal"}
          autoSaveId={narrow ? "sketch-layout-v" : "sketch-layout-h"}
          className="min-h-0 flex-1"
        >
          <ResizablePanel id="board" defaultSize={narrow ? 55 : 63} minSize="30%">
            {boardPane}
          </ResizablePanel>
          <ResizableHandle
            aria-label="Resize board and lesson panels"
            className="relative shrink-0 bg-border transition-colors outline-none focus-visible:bg-ring data-dragging:bg-ring data-hovering:bg-ring data-[orientation=horizontal]:w-px data-[orientation=vertical]:h-px"
          />
          <ResizablePanel id="lesson" defaultSize={narrow ? 45 : 37} minSize={narrow ? "25%" : "320px"}>
            {chatPane}
          </ResizablePanel>
        </Resizable>
      </div>
    </TutorContext.Provider>
  )
}
