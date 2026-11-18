"use client"

import * as React from "react"

import { BOARD_SNAPSHOT_NAME, type TutorUIMessage } from "@/lib/agent/types"
import { getLibraryId } from "@/lib/context/client"
import type { LessonPayload, LessonRecord, LessonSummary } from "./types"

const CURRENT_KEY = "sketch-current-lesson"

export const newLessonId = () => crypto.randomUUID()

export function rememberCurrentLesson(id: string | null) {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id)
    else localStorage.removeItem(CURRENT_KEY)
  } catch {}
}

export function currentLessonId() {
  try {
    return localStorage.getItem(CURRENT_KEY)
  } catch {
    return null
  }
}

type Part = TutorUIMessage["parts"][number]

/**
 * What gets saved: board snapshots are dropped (they're only for the model at
 * the time, and the board itself is saved) and the message remembers it had one.
 */
export function messagesForSaving(messages: TutorUIMessage[]): TutorUIMessage[] {
  return messages.map((m) => {
    if (m.role !== "user") return m
    const parts = m.parts.filter((p) => !(p.type === "file" && p.filename === BOARD_SNAPSHOT_NAME))
    if (parts.length === m.parts.length) return m
    return { ...m, parts, metadata: { ...m.metadata, sharedBoard: true } }
  })
}

/** Tools that wait on the student and can still be answered after a reload. */
const ANSWERABLE = new Set(["tool-quiz"])

/**
 * A lesson saved mid-turn can hold tool calls that never finished. Close them
 * as interrupted so the conversation stays valid for the model (open question
 * cards stay answerable).
 */
export function settleInterrupted(messages: TutorUIMessage[]): TutorUIMessage[] {
  return messages.map((m) => {
    if (m.role !== "assistant") return m
    let changed = false
    const parts = m.parts.map((p): Part => {
      if (!p.type.startsWith("tool-")) return p
      const t = p as Extract<Part, { type: `tool-${string}` }>
      const open = t.state === "input-streaming" || (t.state === "input-available" && !ANSWERABLE.has(t.type))
      if (!open) return p
      changed = true
      return {
        ...t,
        state: "output-error",
        input: t.input ?? {},
        errorText: "Interrupted — the lesson was closed before this finished.",
      } as Part
    })
    return changed ? { ...m, parts } : m
  })
}

export function useLessons() {
  // Same per-browser id as the library; never rendered, so reading storage lazily is safe.
  const [owner] = React.useState<string | null>(() => (typeof window === "undefined" ? null : getLibraryId()))
  const [lessons, setLessons] = React.useState<LessonSummary[]>([])
  const [loaded, setLoaded] = React.useState(false)

  const headers = React.useMemo(() => {
    const h: Record<string, string> = {}
    if (owner) h["x-sketch-owner"] = owner
    return h
  }, [owner])

  const refresh = React.useCallback(async () => {
    if (!owner) return
    try {
      const res = await fetch("/api/lessons", { headers })
      if (res.ok) setLessons(((await res.json()) as { lessons: LessonSummary[] }).lessons)
    } finally {
      setLoaded(true)
    }
  }, [owner, headers])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const save = React.useCallback(
    async (id: string, payload: LessonPayload) => {
      if (!owner) return null
      const res = await fetch(`/api/lessons/${id}`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`)
      const summary = (await res.json()) as LessonSummary
      setLessons((rows) => [summary, ...rows.filter((r) => r.id !== id)])
      return summary
    },
    [owner, headers]
  )

  const load = React.useCallback(
    async (id: string): Promise<LessonRecord | null> => {
      if (!owner) return null
      const res = await fetch(`/api/lessons/${id}`, { headers })
      return res.ok ? ((await res.json()) as LessonRecord) : null
    },
    [owner, headers]
  )

  const rename = React.useCallback(
    async (id: string, title: string) => {
      const res = await fetch(`/api/lessons/${id}`, {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ title }),
      })
      if (res.ok) {
        const row = (await res.json()) as LessonSummary
        setLessons((rows) => rows.map((r) => (r.id === id ? row : r)))
      }
    },
    [headers]
  )

  const remove = React.useCallback(
    async (id: string) => {
      setLessons((rows) => rows.filter((r) => r.id !== id))
      await fetch(`/api/lessons/${id}`, { method: "DELETE", headers })
    },
    [headers]
  )

  return { owner, lessons, loaded, refresh, save, load, rename, remove }
}

export type LessonsApi = ReturnType<typeof useLessons>
