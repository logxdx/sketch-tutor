"use client"

import * as React from "react"

import type { TutorUIMessage } from "@/lib/agent/types"
import type { BoardController } from "@/lib/board/controller"
import { loadPhonon, pauseSpeech, pickEngine, resumeSpeech } from "@/lib/voice/engines"
import { clearHighlight, highlightSentence, sentencesFromMarkdown } from "@/lib/voice/highlight"
import type { VoicePrefs } from "@/lib/voice/prefs"
import { sentencesOf, type SpokenSentence } from "@/lib/voice/sentences"
import { splitSteps } from "./steps"

/** `data-narration` value of a rendered narration block. */
export const narrationAttr = (messageId: string, part: number) => `${messageId}:${part}`

type Progress = { narrated: boolean; draws: number; sentence: number; total: number }
const FRESH: Progress = { narrated: false, draws: 0, sentence: -1, total: 0 }

/** A drawing that never shows up (its tool call failed) mustn't hold the lesson forever. */
const DRAW_TIMEOUT_MS = 20_000

/**
 * The lesson player. The tutor's newest reply is paced: the student sees (and hears) one step
 * at a time and moves on with Continue — or automatically. The tutor keeps writing ahead;
 * its board drawings wait, laid out but invisible, until their step plays.
 *
 * Replies from before (a restored lesson, or ones the student moved past) show in full.
 */
export function useLessonPlayer({
  messages,
  streaming,
  board,
  prefs,
}: {
  messages: TutorUIMessage[]
  streaming: boolean
  board: BoardController | null
  prefs: VoicePrefs
}) {
  /** Messages already shown whole, with how many parts they had then: only later parts are paced. */
  const [settled, setSettled] = React.useState<ReadonlyMap<string, number>>(() => new Map())
  const [playheads, setPlayheads] = React.useState<Record<string, number>>({})
  const [progress, setProgress] = React.useState<Record<string, Progress>>({})
  const [paused, setPaused] = React.useState(false)
  const [replays, setReplays] = React.useState(0)
  const [waitingForNext, setWaitingForNext] = React.useState(false)

  const last = messages.at(-1)
  const seen = last ? settled.get(last.id) : undefined
  const paced =
    prefs.stepByStep && last?.role === "assistant" && (seen === undefined || last.parts.length > seen) ? last : null
  const pacedId = paced?.id ?? null
  const steps = React.useMemo(() => (paced ? splitSteps(paced.parts) : []), [paced])
  // A restored reply that carries on (the student answered its question) starts at the new part.
  const firstNew = seen === undefined ? 0 : Math.max(0, steps.findIndex((s) => s.end > seen))
  const playhead = pacedId ? Math.min(Math.max(playheads[pacedId] ?? 0, firstNew), Math.max(0, steps.length - 1)) : 0
  const step = paced ? steps[playhead] : undefined
  const stepKey = pacedId && step ? `${pacedId}:${playhead}` : ""
  const prog = progress[stepKey] ?? FRESH
  const hasNext = playhead < steps.length - 1
  const done = !!step && step.ready && prog.narrated && prog.draws === 0

  /** What the lesson panel shows: the paced reply only up to the current step. */
  const visibleMessages = React.useMemo(() => {
    if (!paced || !step) return messages
    return messages.map((m) => (m === paced ? { ...m, parts: m.parts.slice(0, step.end) } : m))
  }, [messages, paced, step])

  const patch = React.useCallback((key: string, p: Partial<Progress> | ((cur: Progress) => Partial<Progress>)) => {
    setProgress((all) => {
      const cur = all[key] ?? FRESH
      return { ...all, [key]: { ...cur, ...(typeof p === "function" ? p(cur) : p) } }
    })
  }, [])

  // ------------------------------------------------------------ board

  React.useEffect(() => {
    board?.setDeferred(prefs.stepByStep)
    if (!prefs.stepByStep) board?.flushPending()
  }, [board, prefs.stepByStep])

  const played = React.useRef(new Set<string>())
  const callsKey = step?.boardCalls.join(",") ?? ""
  React.useEffect(() => {
    if (!board || !stepKey || !step) return
    for (const id of step.boardCalls) {
      if (played.current.has(id)) continue
      played.current.add(id)
      queueMicrotask(() => patch(stepKey, (c) => ({ draws: c.draws + 1 })))
      const timeout = new Promise<void>((r) => setTimeout(r, DRAW_TIMEOUT_MS))
      void Promise.race([board.playPending(id), timeout]).finally(() =>
        patch(stepKey, (c) => ({ draws: Math.max(0, c.draws - 1) }))
      )
    }
    // callsKey stands in for step.boardCalls: new calls arriving in the current step get played.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, stepKey, callsKey, patch])

  // -------------------------------------------------------- narration

  const abort = React.useRef<AbortController | null>(null)
  const narrated = React.useRef(new Set<string>())

  // Leaving a step stops its narration.
  React.useEffect(
    () => () => {
      abort.current?.abort()
      clearHighlight()
    },
    [stepKey]
  )
  React.useEffect(() => {
    if (!prefs.narrate) abort.current?.abort()
  }, [prefs.narrate])

  // Start fetching the on-device voice as soon as a lesson starts (cached after the first time).
  React.useEffect(() => {
    if (pacedId && prefs.narrate && prefs.engine === "phonon") void loadPhonon()
  }, [pacedId, prefs.narrate, prefs.engine])

  const ready = !!step?.ready
  const textPart = step?.textPart ?? null
  React.useEffect(() => {
    if (!pacedId || !stepKey || !ready || !paced) return
    const key = `${stepKey}#${replays}`
    if (narrated.current.has(key)) return
    narrated.current.add(key)
    if (textPart === null || !prefs.narrate) {
      queueMicrotask(() => patch(stepKey, { narrated: true }))
      return
    }
    // Read from the rendered narration (so sentences can be highlighted where they are);
    // from the Markdown when the lesson panel shows something else.
    const el = document.querySelector<HTMLElement>(`[data-narration="${narrationAttr(pacedId, textPart)}"]`)
    // Bring the step being read into view in the lesson panel.
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    const sentences: SpokenSentence[] | null = el ? sentencesOf(el) : null
    const part = paced.parts[textPart]
    const texts = sentences?.length ? sentences.map((s) => s.speech) : sentencesFromMarkdown(part.type === "text" ? part.text : "")
    abort.current?.abort()
    const ac = new AbortController()
    abort.current = ac
    queueMicrotask(() => patch(stepKey, { narrated: false, sentence: 0, total: texts.length }))
    void (async () => {
      const engine = await pickEngine(prefs.engine)
      if (ac.signal.aborted || !texts.length) return
      await engine.speak(texts, {
        signal: ac.signal,
        rate: prefs.rate,
        voice: prefs.voice || undefined,
        onSentence: (i) => {
          if (sentences?.length) highlightSentence(sentences, i)
          patch(stepKey, { sentence: i })
        },
      })
    })().finally(() => {
      if (abort.current === ac) {
        abort.current = null
        clearHighlight()
      }
      patch(stepKey, { narrated: true })
    })
    // Narrates each step once (per replay); later changes to prefs apply from the next step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pacedId, stepKey, ready, textPart, replays])

  // -------------------------------------------------------- moving on

  const wantNext = React.useRef(false)
  const goTo = React.useCallback(
    (to: number) => {
      if (!pacedId) return
      abort.current?.abort()
      clearHighlight()
      resumeSpeech()
      setPaused(false)
      setWaitingForNext(false)
      setPlayheads((p) => ({ ...p, [pacedId]: to }))
    },
    [pacedId]
  )

  React.useEffect(() => {
    if (!pacedId || !step) return
    let t: ReturnType<typeof setTimeout> | undefined
    if (hasNext && wantNext.current) {
      wantNext.current = false
      t = setTimeout(() => goTo(playhead + 1), 0)
    } else if (prefs.autoAdvance && done && !step.waits) {
      if (hasNext) t = setTimeout(() => goTo(playhead + 1), 700)
      else if (streaming) wantNext.current = true
    }
    return () => clearTimeout(t)
  }, [pacedId, step, hasNext, done, prefs.autoAdvance, streaming, playhead, goTo])

  /** Continue: the next step now, or as soon as the tutor has written it. */
  const next = React.useCallback(() => {
    if (!pacedId) return
    if (hasNext) goTo(playhead + 1)
    else if (streaming) {
      wantNext.current = true
      setWaitingForNext(true)
    }
  }, [pacedId, hasNext, streaming, playhead, goTo])

  const replay = React.useCallback(() => {
    abort.current?.abort()
    setReplays((r) => r + 1)
  }, [])

  const togglePause = React.useCallback(() => {
    setPaused((p) => {
      if (p) resumeSpeech()
      else pauseSpeech()
      return !p
    })
  }, [])

  /** Done with this reply (the student asked something new): show it all, drawings included. */
  const finish = React.useCallback(() => {
    abort.current?.abort()
    clearHighlight()
    wantNext.current = false
    board?.flushPending()
    if (paced) {
      const parts = paced.parts.length
      setSettled((s) => new Map(s).set(paced.id, parts))
    }
  }, [board, paced])

  /** Messages restored from a saved lesson are shown whole; only what's added to them later is paced. */
  const settle = React.useCallback((restored: TutorUIMessage[]) => {
    abort.current?.abort()
    clearHighlight()
    wantNext.current = false
    setSettled((s) => {
      const next = new Map(s)
      for (const m of restored) next.set(m.id, m.parts.length)
      return next
    })
  }, [])

  return {
    visibleMessages,
    /** A reply is being played step by step. */
    active: !!paced && steps.length > 0 && (streaming || hasNext || !done),
    pacedId,
    index: playhead,
    count: steps.length,
    step,
    done,
    hasNext,
    streaming,
    waitingForNext,
    narrating: !!step?.ready && step.textPart !== null && !prog.narrated && prefs.narrate,
    sentence: prog.sentence,
    sentences: prog.total,
    drawing: prog.draws > 0,
    paused,
    next,
    replay,
    togglePause,
    finish,
    settle,
  }
}

export type LessonPlayer = ReturnType<typeof useLessonPlayer>
