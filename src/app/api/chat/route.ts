import {
  createAgentUIStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type InferUIMessageChunk,
} from "ai"

import { getModel, tutorSeesImages, visionEnabled } from "@/lib/agent/models"
import { createTutorAgent, readBoard } from "@/lib/agent/tutor-agent"
import type { ChatRequestBody, TutorUIMessage } from "@/lib/agent/types"

export const maxDuration = 120

const isImage = (p: TutorUIMessage["parts"][number]) =>
  p.type === "file" && p.mediaType.startsWith("image/")

/** Latest board snapshot the student sent (data URL), if any. */
function latestSnapshot(messages: TutorUIMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== "user") continue
    const part = m.parts.find(isImage)
    if (part && part.type === "file") return part.url
  }
  return null
}

/**
 * The tutor model only needs at most the newest picture (and none at all when
 * a separate vision model reads it). Older pictures are stale and expensive.
 */
function prepareMessages(messages: TutorUIMessage[], keepLatestImage: boolean) {
  let kept = false
  return messages
    .slice()
    .reverse()
    .map((m) => {
      if (m.role !== "user") return m
      const parts = m.parts.filter((p) => {
        if (!isImage(p)) return true
        if (keepLatestImage && !kept) {
          kept = true
          return true
        }
        return false
      })
      return { ...m, parts: parts.length ? parts : [{ type: "text" as const, text: "(board updated)" }] }
    })
    .reverse()
}

export async function POST(req: Request) {
  const { messages, subject, mode, board } = (await req.json()) as ChatRequestBody & {
    messages: TutorUIMessage[]
  }

  try {
    getModel("tutor") // fail fast with a readable error when keys are missing
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }

  const snapshot = visionEnabled() ? latestSnapshot(messages) : null
  const last = messages.at(-1)
  const freshPicture = !!snapshot && last?.role === "user" && last.parts.some(isImage)
  const nativeVision = tutorSeesImages()

  const stream = createUIMessageStream<TutorUIMessage>({
    originalMessages: messages,
    execute: async ({ writer }) => {
      // Stage 1 — perception: read the board when the student just sent a new picture.
      let boardReading: string | null = null
      if (freshPicture && !nativeVision) {
        writer.write({
          type: "data-status",
          data: { stage: "perceive", label: "Looking at your board…" },
          transient: true,
        })
        boardReading = await readBoard(snapshot!, board, req.signal).catch((e) => {
          console.warn("[tutor] board reading failed:", (e as Error).message)
          return null
        })
      }
      writer.write({
        type: "data-status",
        data: { stage: "think", label: "Thinking…" },
        transient: true,
      })

      // Stage 2 — the tutor agent loop.
      const agent = createTutorAgent({ subject, mode, board, boardReading, snapshot })
      const agentStream = await createAgentUIStream({
        agent,
        uiMessages: prepareMessages(messages, nativeVision && visionEnabled()),
        abortSignal: req.signal,
        sendReasoning: true,
        sendSources: true,
      })
      // The agent's stream carries our tools' parts; TutorUIMessage adds only the transient status data part.
      writer.merge(agentStream as unknown as ReadableStream<InferUIMessageChunk<TutorUIMessage>>)
    },
    onError: (error) => {
      console.error("[tutor] stream error", error)
      const message = error instanceof Error ? error.message : String(error)
      return message.length > 400 ? `${message.slice(0, 400)}…` : message
    },
  })

  return createUIMessageStreamResponse({ stream })
}
