import type { z } from "zod"

import type {
  annotateInput,
  askStudentInput,
  drawInput,
  eraseInput,
  plotInput,
  pointAtInput,
} from "@/lib/agent/schemas"

export type DrawInput = z.infer<typeof drawInput>
export type DrawShape = DrawInput["shapes"][number]
export type AnnotateInput = z.infer<typeof annotateInput>
export type PointAtInput = z.infer<typeof pointAtInput>
export type PlotToolInput = z.infer<typeof plotInput>
export type EraseInput = z.infer<typeof eraseInput>
export type AskStudentInput = z.infer<typeof askStudentInput>

export type DrawSpeed = "relaxed" | "normal" | "fast" | "instant"

export type LessonStep = {
  id: string
  title: string
  kind: "draw" | "plot" | "annotate" | "task" | "image"
  elementIds: string[]
  at: number
}

export type YourTurn = { frameId: string; task: string }

/** Everything needed to put a board back exactly as it was (saved with a lesson). */
export type BoardSnapshot = {
  /** Excalidraw elements (plain JSON). */
  elements: unknown[]
  /** Images on the board, by file id (data URLs). */
  files: Record<string, unknown>
  steps: LessonStep[]
  aliases: [string, string][]
  yourTurn: YourTurn | null
}

export type BoardStatus = {
  ready: boolean
  /** What the tutor is doing on the board right now, if anything. */
  activity: string | null
  selection: string[]
  steps: LessonStep[]
  yourTurn: YourTurn | null
  /** Student changed the board since the tutor last looked. */
  studentDirty: boolean
  lastStudentActivity: number
  isEmpty: boolean
  speed: DrawSpeed
}
