"use client"

import * as React from "react"

import type { LessonPlan } from "@/lib/agent/plan"
import type { QuizAnswer } from "@/lib/agent/schemas"
import type { BoardController } from "@/lib/board/controller"
import type { MessageAttachment } from "@/lib/context/types"

export type TutorActions = {
  board: BoardController | null
  busy: boolean
  /** Send a student message (attaches a board snapshot when useful). */
  send: (
    text: string,
    kind?: "chat" | "check" | "watch",
    extras?: { files?: { type: "file"; mediaType: string; url: string; filename: string }[]; attachments?: MessageAttachment[] }
  ) => void
  /** Record the student's answer to a quiz tool call. */
  answerQuiz: (toolCallId: string, output: QuizAnswer) => void
  /** The learning route, if the lesson has one. */
  plan: LessonPlan | null
}

export const TutorContext = React.createContext<TutorActions>({
  board: null,
  busy: false,
  send: () => {},
  answerQuiz: () => {},
  plan: null,
})

export const useTutor = () => React.useContext(TutorContext)
