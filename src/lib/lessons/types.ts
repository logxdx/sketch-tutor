import type { TutorUIMessage } from "@/lib/agent/types"
import type { BoardSnapshot } from "@/lib/board/types"

/** One row of the lesson history. */
export type LessonSummary = {
  id: string
  title: string
  /** Set when the student renamed the lesson (otherwise the title follows the route goal / first question). */
  customTitle?: string
  subject?: string
  mode?: string
  createdAt: number
  updatedAt: number
  messageCount: number
  /** Route progress, when the lesson has a route. */
  progress?: { done: number; total: number }
  /** First words of the first question. */
  preview?: string
}

/** What the browser saves: the conversation plus the board, exactly as it was. */
export type LessonPayload = {
  subject?: string
  mode?: string
  createdAt?: number
  messages: TutorUIMessage[]
  board: BoardSnapshot | null
  /** Nothing new in the conversation (e.g. only the board moved): don't bump it to the top of the history. */
  keepTime?: boolean
}

export type LessonRecord = LessonSummary & LessonPayload

export const isValidLessonId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(id)
