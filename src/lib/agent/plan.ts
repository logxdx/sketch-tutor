import { z } from "zod"

/**
 * The learning route: a small dependency map from what the student already
 * understands to their goal. The tutor builds it with plan_lesson after
 * measuring what they know, and moves through it with plan_update.
 *
 * Client-safe: the server validates tool calls with it, and the browser
 * derives the current route from the conversation (the latest successful plan
 * tool output carries the whole route), so a saved lesson needs no extra state.
 */

export type PlanStatus = "todo" | "current" | "done" | "known"

export type PlanNode = {
  id: string
  title: string
  summary?: string
  needs: string[]
  status: PlanStatus
}

export type LessonPlan = {
  goal: string
  nodes: PlanNode[]
  current: string | null
}

const nodeId = z.string().min(1).max(40).describe('Short kebab-case id, e.g. "slope-as-rate".')

export const planLessonInput = z.object({
  goal: z.string().describe("What the student wants to understand, in their words (becomes the lesson title)."),
  nodes: z
    .array(
      z.object({
        id: nodeId,
        title: z.string().describe("3-6 words."),
        summary: z.string().optional().describe("One sentence: what the student will be able to see or do after this step."),
        needs: z.array(z.string()).optional().describe("Ids of steps that must be understood first."),
        status: z
          .enum(["todo", "known", "done"])
          .optional()
          .describe("known = the student already showed they understand it (from your probe questions). Default todo."),
      })
    )
    .min(2)
    .max(12),
  current: z.string().optional().describe("Step to teach first. Default: the first step whose needs are all understood."),
})

export const planUpdateInput = z.object({
  current: z.string().optional().describe("The step you are teaching now."),
  done: z.array(z.string()).optional().describe("Steps the student has now shown they understand."),
  known: z.array(z.string()).optional().describe("Steps they turned out to know already."),
  reopen: z.array(z.string()).optional().describe("Steps to mark not-yet-understood again (a misconception surfaced)."),
})

export type PlanLessonInput = z.infer<typeof planLessonInput>
export type PlanUpdateInput = z.infer<typeof planUpdateInput>

const understood = (s: PlanStatus) => s === "done" || s === "known"

/** First step (in dependency order) that isn't understood yet and whose needs all are. */
export function nextReady(nodes: PlanNode[]): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const id of topoOrder(nodes)) {
    const n = byId.get(id)!
    if (understood(n.status)) continue
    if (n.needs.every((d) => understood(byId.get(d)?.status ?? "todo"))) return n.id
  }
  return null
}

/** Ids in dependency order (prerequisites first); input order breaks ties. */
export function topoOrder(nodes: PlanNode[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const visit = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    for (const d of byId.get(id)?.needs ?? []) visit(d)
    out.push(id)
  }
  nodes.forEach((n) => visit(n.id))
  return out
}

/** Column per step = length of the longest prerequisite chain before it. */
export function planLayers(plan: LessonPlan): string[][] {
  const byId = new Map(plan.nodes.map((n) => [n.id, n]))
  const depth = new Map<string, number>()
  for (const id of topoOrder(plan.nodes)) {
    const needs = byId.get(id)?.needs ?? []
    depth.set(id, needs.length ? Math.max(...needs.map((d) => (depth.get(d) ?? 0) + 1)) : 0)
  }
  const layers: string[][] = []
  for (const n of plan.nodes) (layers[depth.get(n.id) ?? 0] ??= []).push(n.id)
  return layers.filter(Boolean)
}

function findCycle(nodes: PlanNode[]): string[] | null {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const state = new Map<string, 1 | 2>()
  const stack: string[] = []
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 2) return null
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id]
    state.set(id, 1)
    stack.push(id)
    for (const d of byId.get(id)?.needs ?? []) {
      const c = visit(d)
      if (c) return c
    }
    stack.pop()
    state.set(id, 2)
    return null
  }
  for (const n of nodes) {
    const c = visit(n.id)
    if (c) return c
  }
  return null
}

function setCurrent(nodes: PlanNode[], current: string | null): LessonPlan["nodes"] {
  return nodes.map((n) =>
    n.id === current ? { ...n, status: "current" } : n.status === "current" ? { ...n, status: "todo" } : n
  )
}

export function buildPlan(input: PlanLessonInput): { plan: LessonPlan } | { error: string } {
  const ids = input.nodes.map((n) => n.id.trim())
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (dupes.length) return { error: `Duplicate step ids: ${[...new Set(dupes)].join(", ")}. Give every step its own id.` }
  const known = new Set(ids)
  const nodes: PlanNode[] = input.nodes.map((n) => ({
    id: n.id.trim(),
    title: n.title.trim(),
    summary: n.summary?.trim() || undefined,
    needs: [...new Set((n.needs ?? []).map((d) => d.trim()))].filter((d) => d !== n.id.trim()),
    status: n.status ?? "todo",
  }))
  const unknown = nodes.flatMap((n) => n.needs.filter((d) => !known.has(d)).map((d) => `${n.id} needs "${d}"`))
  if (unknown.length) return { error: `Unknown step ids in needs: ${unknown.join("; ")}. Use ids from this plan.` }
  const cycle = findCycle(nodes)
  if (cycle) return { error: `The steps depend on each other in a circle (${cycle.join(" → ")}). A route must lead one way.` }
  if (input.current && !known.has(input.current)) return { error: `current "${input.current}" is not a step in this plan.` }
  const current = input.current ?? nextReady(nodes)
  return { plan: { goal: input.goal.trim(), nodes: setCurrent(nodes, current), current } }
}

export function applyPlanUpdate(plan: LessonPlan, input: PlanUpdateInput): { plan: LessonPlan } | { error: string } {
  const ids = new Set(plan.nodes.map((n) => n.id))
  const mentioned = [...(input.done ?? []), ...(input.known ?? []), ...(input.reopen ?? []), ...(input.current ? [input.current] : [])]
  const bad = mentioned.filter((id) => !ids.has(id))
  if (bad.length) return { error: `Unknown step ids: ${bad.join(", ")}. Steps: ${[...ids].join(", ")}.` }
  const status = new Map(plan.nodes.map((n) => [n.id, n.status]))
  for (const id of input.reopen ?? []) status.set(id, "todo")
  for (const id of input.known ?? []) status.set(id, "known")
  for (const id of input.done ?? []) status.set(id, "done")
  let nodes = plan.nodes.map((n) => ({ ...n, status: status.get(n.id)! }))
  // Moving on: the explicit step, else the old one if it's still open, else the next ready step.
  const old = plan.current && nodes.find((n) => n.id === plan.current && n.status === "current")?.id
  const current = input.current ?? old ?? nextReady(nodes)
  nodes = setCurrent(nodes, current ?? null)
  return { plan: { ...plan, nodes, current: current ?? null } }
}

export function planProgress(plan: LessonPlan) {
  const total = plan.nodes.length
  const done = plan.nodes.filter((n) => understood(n.status)).length
  return { done, total, finished: done === total }
}

type PartLike = { type: string; state?: string; output?: unknown }

/** The route as of the latest successful plan tool call in the conversation. */
export function derivePlan(messages: readonly { parts: readonly PartLike[] }[]): LessonPlan | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i].parts
    for (let j = parts.length - 1; j >= 0; j--) {
      const p = parts[j]
      if ((p.type === "tool-plan_lesson" || p.type === "tool-plan_update") && p.state === "output-available") {
        const out = p.output as { ok?: boolean; plan?: LessonPlan } | undefined
        if (out?.ok && out.plan) return out.plan
      }
    }
  }
  return null
}

const MARK: Record<PlanStatus, string> = { done: "✓ understood", known: "✓ already knew", current: "▶ NOW", todo: "· to do" }

/** The route for the system prompt. */
export function planForPrompt(plan: LessonPlan) {
  const byId = new Map(plan.nodes.map((n) => [n.id, n]))
  const { done, total } = planProgress(plan)
  const lines = topoOrder(plan.nodes).map((id) => {
    const n = byId.get(id)!
    const needs = n.needs.length ? ` (needs ${n.needs.join(", ")})` : ""
    return `- [${MARK[n.status]}] ${n.id}: ${n.title}${n.summary ? ` — ${n.summary}` : ""}${needs}`
  })
  return `LEARNING ROUTE (drawn on the board as a map; ${done}/${total} understood)\nGoal: ${plan.goal}\n${lines.join("\n")}`
}
