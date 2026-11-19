"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai"
import {
  EyeIcon,
  GaugeIcon,
  GraduationCapIcon,
  HandIcon,
  HistoryIcon,
  LayoutGridIcon,
  MessageCircleQuestionIcon,
  MoonIcon,
  PlayIcon,
  PlusIcon,
  Settings2Icon,
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
import { PlayerBar } from "@/components/lesson/player-bar"
import { LessonHistory } from "@/components/lessons/lesson-history"
import { SettingsDialog } from "@/components/settings/settings-dialog"
import { CommandPalette, type PaletteAction } from "@/components/ui-sdk/command-palette"
import { IconButton, PickList, Segmented, Toggle } from "@/components/ui-sdk/controls"
import { derivePlan } from "@/lib/agent/plan"
import { BOARD_SNAPSHOT_NAME, MODES, SUBJECTS, type Mode, type Subject, type TutorUIMessage } from "@/lib/agent/types"
import { useLibrary } from "@/lib/context/use-library"
import { useLessonPlayer } from "@/lib/lesson/use-lesson-player"
import { useVoicePrefs } from "@/lib/voice/prefs"
import type { LessonRecord } from "@/lib/lessons/types"
import {
  currentLessonId,
  messagesForSaving,
  newLessonId,
  rememberCurrentLesson,
  settleInterrupted,
  useLessons,
} from "@/lib/lessons/use-lessons"
import { useSettings } from "@/lib/settings/use-settings"
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
/** Cheap fingerprint of the conversation: changes whenever a message or part is added or grows. */
function conversationSignature(messages: TutorUIMessage[]) {
  const last = messages.at(-1)
  if (!last) return ""
  const tail = last.parts.at(-1)
  return `${messages.length}:${last.id}:${last.parts.length}:${tail ? JSON.stringify(tail).length : 0}`
}

const BOARD_TOOLS = new Set(["draw", "plot", "annotate", "point_at", "erase", "ask_student"])
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
  const library = useLibrary()
  const settingsApi = useSettings()
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const tutorSettingsRef = React.useRef(settingsApi.settings)
  React.useEffect(() => {
    tutorSettingsRef.current = settingsApi.settings
  }, [settingsApi.settings])
  const libraryIdRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    libraryIdRef.current = library.libraryId
  }, [library.libraryId])
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
          return {
            ...settings.current,
            board: text,
            libraryId: libraryIdRef.current,
            settings: tutorSettingsRef.current,
          }
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
            run = b.pointAt(input, id)
            break
          case "erase":
            run = b.erase(input, id)
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
        if (autoTurns.current >= tutorSettingsRef.current.agent.autoContinue) return false
        autoTurns.current++
        return true
      },
    })

  const busy = status === "submitted" || status === "streaming"
  const busyRef = React.useRef(busy)
  React.useEffect(() => {
    busyRef.current = busy
  }, [busy])

  // Step-by-step playback of the newest reply, read aloud (see useLessonPlayer).
  const voicePrefs = useVoicePrefs()
  const player = useLessonPlayer({ messages, streaming: busy, board, prefs: voicePrefs })
  const finishPlayback = React.useRef(player.finish)
  React.useEffect(() => {
    finishPlayback.current = player.finish
  }, [player.finish])

  const send = React.useCallback<TutorActions["send"]>(
    async (text, kind = "chat", extras) => {
      // Moving on: whatever of the last reply is still waiting goes on the board now.
      finishPlayback.current()
      const b = boardRef.current
      const s = b?.getStatus()
      const files: { type: "file"; mediaType: string; url: string; filename: string }[] = [...(extras?.files ?? [])]
      // Share a picture of the board only when it adds something the text description can't.
      if (b && s && !s.isEmpty && (kind !== "chat" || s.studentDirty || s.yourTurn || s.selection.length)) {
        try {
          const url = await b.snapshot()
          if (url) files.push({ type: "file", mediaType: "image/jpeg", url, filename: BOARD_SNAPSHOT_NAME })
        } catch (e) {
          console.warn("snapshot failed", e)
        }
      }
      pendingBoardText.current = b?.describe() ?? null
      autoTurns.current = 0
      setStatusLabel(null)
      const attachments = extras?.attachments?.length ? extras.attachments : undefined
      const sharedBoard = files.some((f) => f.filename === BOARD_SNAPSHOT_NAME) || undefined
      sendMessage({ text, files: files.length ? files : undefined, metadata: { kind, attachments, sharedBoard } })
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
    finishPlayback.current()
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
  useShortcut("mod+,", () => setSettingsOpen(true), { description: "Open settings" })

  // ------------------------------------------------------------ the route

  // The route lives in the conversation (plan tool outputs); the board map follows it.
  // Paced: the route as of the step the student is on, so the map lights up with the lesson.
  const plan = React.useMemo(() => derivePlan(player.visibleMessages), [player.visibleMessages])
  const planKey = plan ? JSON.stringify(plan) : ""
  React.useEffect(() => {
    if (board && plan) board.renderPlan(plan).catch(() => {})
    // planKey stands in for plan: redraw only when the route actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, planKey])

  // --------------------------------------------------------- saved lessons

  const lessons = useLessons()
  const { save: saveLesson, load: loadLesson } = lessons
  const [historyOpen, setHistoryOpen] = React.useState(false)
  // The id is never rendered on the server, so picking it lazily from storage can't cause a hydration mismatch.
  const [lessonId, setLessonIdState] = React.useState(() =>
    typeof window === "undefined" ? "" : (currentLessonId() ?? newLessonId())
  )
  const lessonIdRef = React.useRef(lessonId)
  const createdAtRef = React.useRef(0)
  const messagesRef = React.useRef(messages)
  React.useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  const setLessonId = React.useCallback((id: string) => {
    lessonIdRef.current = id
    setLessonIdState(id)
    rememberCurrentLesson(id)
  }, [])

  /** What the conversation looked like at the last save/load (unchanged → don't reorder the history). */
  const savedSigRef = React.useRef("")
  /** While a saved lesson is being put back, its own changes aren't new edits. */
  const restoringRef = React.useRef(false)
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveNow = React.useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    const msgs = messagesRef.current
    if (!msgs.length || !lessonIdRef.current || restoringRef.current) return
    if (!createdAtRef.current) createdAtRef.current = Date.now()
    const sig = conversationSignature(msgs)
    const keepTime = sig === savedSigRef.current
    savedSigRef.current = sig
    saveLesson(lessonIdRef.current, {
      ...settings.current,
      keepTime,
      createdAt: createdAtRef.current,
      messages: messagesForSaving(msgs),
      board: boardRef.current?.exportState() ?? null,
    }).catch((e: Error) => console.warn("[lessons] save failed:", e.message))
  }, [saveLesson])

  /** Debounced when idle; while the tutor streams, at most every few seconds. */
  const scheduleSave = React.useCallback(
    (delay: number, throttle = false) => {
      if (restoringRef.current) return
      if (throttle && saveTimer.current) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(saveNow, delay)
    },
    [saveNow]
  )

  React.useEffect(() => {
    if (messages.length) scheduleSave(busy ? 4000 : 800, busy)
  }, [messages, busy, scheduleSave])

  React.useEffect(() => {
    if (!board) return
    return board.subscribeScene(() => {
      if (messagesRef.current.length) scheduleSave(busyRef.current ? 4000 : 1500, true)
    })
  }, [board, scheduleSave])

  const applyLesson = React.useCallback(
    (record: LessonRecord) => {
      restoringRef.current = true
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = null
      boardRef.current?.loadState(record.board)
      const restored = settleInterrupted(record.messages)
      player.settle(restored)
      savedSigRef.current = conversationSignature(restored)
      setMessages(restored)
      if (SUBJECTS.some((s) => s.value === record.subject)) setSubject(record.subject as Subject)
      if (MODES.some((m) => m.value === record.mode)) setMode(record.mode as Mode)
      createdAtRef.current = record.createdAt
      autoTurns.current = 0
      setLessonId(record.id)
      setTimeout(() => {
        restoringRef.current = false
      }, 800)
    },
    [setMessages, setLessonId, player.settle]
  )

  // On load: pick up where this browser left off.
  const restoredRef = React.useRef(false)
  React.useEffect(() => {
    if (!board || restoredRef.current) return
    restoredRef.current = true
    const id = lessonIdRef.current
    rememberCurrentLesson(id)
    loadLesson(id).then((record) => {
      if (!record) return
      // Already chatting before the saved lesson arrived: keep that as a new lesson.
      if (messagesRef.current.length) setLessonId(newLessonId())
      else applyLesson(record)
    })
  }, [board, loadLesson, applyLesson, setLessonId])

  const newLesson = React.useCallback(
    ({ save = true }: { save?: boolean } = {}) => {
    if (save) saveNow()
    else if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    stopAll()
    savedSigRef.current = ""
    setMessages([])
    board?.clearBoard()
    createdAtRef.current = Date.now()
    setLessonId(newLessonId())
    if (save) toast("New lesson", { description: "Fresh board, fresh conversation. The last one is in your history." })
    },
    [board, setMessages, stopAll, saveNow, setLessonId]
  )

  const openLesson = React.useCallback(
    async (id: string) => {
      if (id === lessonIdRef.current) return
      saveNow()
      const record = await loadLesson(id)
      if (!record) {
        toast.error("Couldn't open that lesson")
        return
      }
      stopAll()
      applyLesson(record)
    },
    [loadLesson, saveNow, stopAll, applyLesson]
  )

  const setSpeed = (speed: DrawSpeed) => {
    board?.setSpeed(speed)
    toast(`Drawing speed: ${speed}`)
  }

  const actions: PaletteAction[] = [
    { id: "new", group: "Lesson", label: "New lesson", icon: <PlusIcon />, shortcut: "mod+shift+o", run: () => newLesson() },
    {
      id: "history",
      group: "Lesson",
      label: "Lesson history — open a past lesson",
      icon: <HistoryIcon />,
      keywords: ["saved", "previous", "chats", "open"],
      run: () => setHistoryOpen(true),
    },
    ...lessons.lessons
      .filter((l) => l.id !== lessonId)
      .slice(0, 8)
      .map((l) => ({
        id: `open-${l.id}`,
        group: "Recent lessons",
        label: l.title,
        icon: <HistoryIcon />,
        run: () => void openLesson(l.id),
      })),
    ...(plan
      ? [{ id: "route", group: "Lesson", label: "Show the route on the board", icon: <LayoutGridIcon />, run: () => board?.focusRoute() }]
      : []),
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
    { id: "settings", group: "Appearance", label: "Settings — models, thinking, sampling", icon: <Settings2Icon />, shortcut: "mod+,", keywords: ["model", "provider", "temperature", "effort", "reasoning"], run: () => setSettingsOpen(true) },
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

  const ctx = React.useMemo<TutorActions>(
    () => ({ board, busy, send, answerQuiz, plan }),
    [board, busy, send, answerQuiz, plan]
  )

  const boardPane = (
    <div className="relative h-full min-h-0 overflow-hidden bg-background">
      <Whiteboard
        theme={theme}
        onReady={(c) => {
          boardRef.current = c
          setBoard(c)
        }}
      />
      <PlayerBar player={player} prefs={voicePrefs} hasSelection={boardStatus.selection.length > 0} />
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
      messages={player.visibleMessages}
      player={player}
      status={status}
      statusLabel={statusLabel}
      error={error}
      board={boardStatus}
      library={library}
      settings={settingsApi}
      onOpenSettings={() => setSettingsOpen(true)}
      onStartLearning={(goal) => {
        setMode("learn")
        // The request body reads this ref; update it now rather than after the re-render.
        settings.current = { ...settings.current, mode: "learn" }
        send(`I want to learn: ${goal}`)
      }}
      onStop={stopAll}
      onRetry={() => regenerate()}
    />
  )

  return (
    <TutorContext.Provider value={ctx}>
      <div className="flex h-dvh flex-col">
        <header className="flex h-13 shrink-0 items-center gap-2 border-b bg-background px-3">
          <IconButton label="Lesson history" onClick={() => setHistoryOpen(true)}>
            <HistoryIcon />
          </IconButton>
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
            <IconButton label="Settings" shortcut="mod+," onClick={() => setSettingsOpen(true)}>
              <Settings2Icon />
            </IconButton>
            <IconButton label="New lesson" onClick={() => newLesson()}>
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
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        api={settingsApi}
        speed={boardStatus.speed}
        onSpeedChange={(sp) => board?.setSpeed(sp)}
      />
      <LessonHistory
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        api={lessons}
        currentId={lessonId}
        onOpenLesson={(id) => void openLesson(id)}
        onNewLesson={() => newLesson()}
        onCurrentDeleted={() => newLesson({ save: false })}
      />
    </TutorContext.Provider>
  )
}
