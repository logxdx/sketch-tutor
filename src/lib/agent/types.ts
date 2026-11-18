import type { InferUITools, UIMessage } from "ai"

import type { createLibraryTools } from "@/lib/context/tools"
import type { MessageAttachment } from "@/lib/context/types"
import type { clientTools } from "./client-tools"
import type { ServerTools } from "./server-tools"

export type TutorTools = typeof clientTools & ServerTools & ReturnType<typeof createLibraryTools>

export type TutorMessageMetadata = {
  /** chat = typed; watch = automatic nudge while the student draws; check = "check my work". */
  kind?: "chat" | "watch" | "check"
  /** Library documents / folders attached to this message. */
  attachments?: MessageAttachment[]
  /** Assistant replies: which model, provider and thinking level produced them. */
  model?: string
  provider?: string
  effort?: string
}

/** File name the board snapshot is sent with (other image parts are student uploads). */
export const BOARD_SNAPSHOT_NAME = "board.jpg"

export type TutorDataParts = {
  status: { stage: "perceive" | "think"; label: string }
}

export type TutorUIMessage = UIMessage<TutorMessageMetadata, TutorDataParts, InferUITools<TutorTools>>

export const SUBJECTS = [
  { value: "general", label: "Anything" },
  { value: "math", label: "Mathematics" },
  { value: "physics", label: "Physics" },
  { value: "chemistry", label: "Chemistry" },
  { value: "biology", label: "Biology" },
  { value: "cs", label: "Computer science" },
  { value: "history", label: "History" },
  { value: "geography", label: "Geography" },
  { value: "economics", label: "Economics" },
  { value: "language", label: "Languages & writing" },
  { value: "arts", label: "Arts & music" },
] as const
export type Subject = (typeof SUBJECTS)[number]["value"]

export const MODES = [
  { value: "explain", label: "Explain", hint: "Tutor leads, draws and shows" },
  { value: "guide", label: "Guide", hint: "Socratic: you do the thinking" },
  { value: "quiz", label: "Quiz", hint: "Practice questions, marked live" },
] as const
export type Mode = (typeof MODES)[number]["value"]

export type ChatRequestBody = {
  subject?: Subject
  mode?: Mode
  board?: string | null
  libraryId?: string | null
}
