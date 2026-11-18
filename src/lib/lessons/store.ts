import "server-only"

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { derivePlan, planProgress } from "@/lib/agent/plan"
import { isValidLessonId, type LessonPayload, type LessonRecord, type LessonSummary } from "./types"

/**
 * Lessons on disk: .data/lessons/<owner>/<lesson>.json plus an index.json of
 * summaries per owner (the browser's id, same as its library). Plain JSON
 * files you can inspect; writes go through a temp file and a rename.
 */
const ROOT = path.join(process.cwd(), ".data", "lessons")

export const isValidOwner = isValidLessonId

const dir = (owner: string) => path.join(ROOT, owner)
const file = (owner: string, id: string) => path.join(dir(owner), `${id}.json`)
const indexFile = (owner: string) => path.join(dir(owner), "index.json")

/** One writer per owner at a time, so concurrent saves can't lose index rows. */
const locks = new Map<string, Promise<unknown>>()
function withLock<T>(owner: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(owner) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  locks.set(
    owner,
    next.catch(() => undefined)
  )
  return next
}

async function writeAtomic(target: string, data: string) {
  await mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, target)
}

async function readIndex(owner: string): Promise<LessonSummary[]> {
  try {
    return JSON.parse(await readFile(indexFile(owner), "utf8")) as LessonSummary[]
  } catch {
    return []
  }
}

const writeIndex = (owner: string, rows: LessonSummary[]) => writeAtomic(indexFile(owner), JSON.stringify(rows))

const clean = (s: string) =>
  s
    .replace(/^\[(check|watching)\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()

function firstQuestion(payload: LessonPayload) {
  for (const m of payload.messages) {
    if (m.role !== "user" || m.metadata?.kind === "watch") continue
    const text = clean(m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" "))
    if (text) return text
  }
  return ""
}

function summarize(id: string, payload: LessonPayload, prev?: LessonSummary): LessonSummary {
  const plan = derivePlan(payload.messages)
  const question = firstQuestion(payload)
  const auto = plan?.goal || question || "Untitled lesson"
  const now = Date.now()
  return {
    id,
    title: prev?.customTitle || (auto.length > 80 ? `${auto.slice(0, 77)}…` : auto),
    customTitle: prev?.customTitle,
    subject: payload.subject,
    mode: payload.mode,
    createdAt: prev?.createdAt ?? payload.createdAt ?? now,
    updatedAt: payload.keepTime && prev ? prev.updatedAt : now,
    messageCount: payload.messages.length,
    progress: plan ? (({ done, total }) => ({ done, total }))(planProgress(plan)) : undefined,
    preview: question.slice(0, 140) || undefined,
  }
}

export async function listLessons(owner: string) {
  const rows = await readIndex(owner)
  return rows.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getLesson(owner: string, id: string): Promise<LessonRecord | null> {
  if (!isValidLessonId(id)) return null
  try {
    return JSON.parse(await readFile(file(owner, id), "utf8")) as LessonRecord
  } catch {
    return null
  }
}

export function saveLesson(owner: string, id: string, payload: LessonPayload) {
  return withLock(owner, async () => {
    const rows = await readIndex(owner)
    const prev = rows.find((r) => r.id === id)
    const summary = summarize(id, payload, prev)
    const { keepTime: _keep, ...data } = payload
    const record: LessonRecord = { ...summary, ...data, createdAt: summary.createdAt }
    await writeAtomic(file(owner, id), JSON.stringify(record))
    await writeIndex(owner, [summary, ...rows.filter((r) => r.id !== id)])
    return summary
  })
}

export function renameLesson(owner: string, id: string, title: string) {
  return withLock(owner, async () => {
    const rows = await readIndex(owner)
    const row = rows.find((r) => r.id === id)
    if (!row) return null
    const t = title.replace(/\s+/g, " ").trim().slice(0, 120)
    // Empty title = go back to the automatic one (shown again on the next save).
    const next = { ...row, customTitle: t || undefined, title: t || row.title }
    await writeIndex(owner, rows.map((r) => (r.id === id ? next : r)))
    const record = await getLesson(owner, id)
    if (record) await writeAtomic(file(owner, id), JSON.stringify({ ...record, title: next.title, customTitle: next.customTitle }))
    return next
  })
}

export function deleteLesson(owner: string, id: string) {
  return withLock(owner, async () => {
    const rows = await readIndex(owner)
    await rm(file(owner, id), { force: true })
    await writeIndex(owner, rows.filter((r) => r.id !== id))
    return rows.some((r) => r.id === id)
  })
}
