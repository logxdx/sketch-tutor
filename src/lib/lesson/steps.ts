/**
 * Lesson steps: a tutor reply cut into what the student moves through with Continue.
 *
 * A step starts at a piece of narration (a text part) and owns the visuals that follow it —
 * board drawings, 3D scenes, charts, questions — until the next narration. Research and lookups
 * belong to the step they lead into. Client-safe and pure, so it can run on every render.
 */

/** Board tools: laid out invisibly while the tutor writes, drawn when their step plays. */
export const BOARD_TOOLS = new Set(["draw", "plot", "annotate", "point_at", "erase", "ask_student"])

/** Tools whose output is something to look at or do (the rest is the tutor's own working). */
const VISUAL_TOOLS = new Set([...BOARD_TOOLS, "show_3d", "chart", "explore", "find_images", "quiz", "plan_lesson"])

/** The student has to act before the lesson can go on. */
const WAITING_TOOLS = new Set(["quiz", "ask_student"])

type PartLike = { type: string; state?: string; text?: string; toolCallId?: string }

export type LessonStep = {
  index: number
  /** Parts [start, end) of the message belong to this step. */
  start: number
  end: number
  /** Index of the narration text part, if the step has one. */
  textPart: number | null
  /** Board tool calls to draw when the step plays, in order. */
  boardCalls: string[]
  /** Something to look at besides the narration. */
  visuals: number
  /** Ends in a question or task for the student. */
  waits: boolean
  /** Its narration is complete (and its tool inputs have arrived), so it can be played. */
  ready: boolean
}

export function splitSteps(parts: readonly PartLike[]): LessonStep[] {
  const steps: LessonStep[] = []
  let cur: LessonStep = blank(0, 0)
  parts.forEach((p, i) => {
    if (p.type === "text") {
      if (!p.text?.trim()) return
      if (cur.textPart !== null || cur.visuals > 0) {
        cur.end = i
        steps.push(cur)
        cur = blank(steps.length, i)
      }
      cur.textPart = i
      return
    }
    if (!p.type.startsWith("tool-")) return
    const name = p.type.slice(5)
    if (!VISUAL_TOOLS.has(name)) return
    cur.visuals++
    if (BOARD_TOOLS.has(name) && p.toolCallId) cur.boardCalls.push(p.toolCallId)
    if (WAITING_TOOLS.has(name)) cur.waits = true
  })
  cur.end = parts.length
  if (cur.textPart !== null || cur.visuals > 0 || !steps.length) steps.push(cur)

  for (const s of steps) {
    const text = s.textPart === null ? null : parts[s.textPart]
    const textDone = !text || text.state !== "streaming"
    const inputsIn = parts
      .slice(s.start, s.end)
      .every((p) => !p.type.startsWith("tool-") || p.state !== "input-streaming")
    s.ready = textDone && inputsIn && (s.textPart !== null || s.visuals > 0)
  }
  return steps
}

function blank(index: number, start: number): LessonStep {
  return { index, start, end: start, textPart: null, boardCalls: [], visuals: 0, waits: false, ready: false }
}
