import {
  createAgentUIStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type InferUIMessageChunk,
} from "ai"

import { getModel, modelId, providerFor, tutorSeesImages, visionEnabled } from "@/lib/agent/models"
import { derivePlan } from "@/lib/agent/plan"
import { parseSettings } from "@/lib/agent/settings"
import { createTutorAgent, describeImages, readBoard } from "@/lib/agent/tutor-agent"
import { BOARD_SNAPSHOT_NAME, type ChatRequestBody, type TutorUIMessage } from "@/lib/agent/types"
import { isValidLibraryId } from "@/lib/context/store"
import { librarySection } from "@/lib/context/tools"

export const maxDuration = 120

type Part = TutorUIMessage["parts"][number]
const isImage = (p: Part): p is Extract<Part, { type: "file" }> => p.type === "file" && p.mediaType.startsWith("image/")
const isSnapshot = (p: Part) => isImage(p) && p.filename === BOARD_SNAPSHOT_NAME
const isUpload = (p: Part) => isImage(p) && p.filename !== BOARD_SNAPSHOT_NAME

/** Most images the tutor model receives in one request (Groq caps at 5). */
const MAX_IMAGES = 5

/** Latest board snapshot the student sent (data URL), if any. */
function latestSnapshot(messages: TutorUIMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== "user") continue
    const part = m.parts.find(isSnapshot)
    if (part && part.type === "file") return part.url
  }
  return null
}

/**
 * What the tutor model sees. With a multimodal tutor: the newest board
 * snapshot plus the student's recent uploaded images (newest first, capped).
 * Otherwise no images — the vision stage has already turned them into text.
 */
function prepareMessages(messages: TutorUIMessage[], nativeVision: boolean) {
  let snapshotKept = false
  let budget = MAX_IMAGES
  return messages
    .slice()
    .reverse()
    .map((m) => {
      if (m.role !== "user") return m
      const parts = m.parts.filter((p) => {
        if (!isImage(p)) return true
        if (!nativeVision || budget <= 0) return false
        if (isSnapshot(p)) {
          if (snapshotKept) return false
          snapshotKept = true
        }
        budget--
        return true
      })
      return { ...m, parts: parts.length ? parts : [{ type: "text" as const, text: "(see attachments)" }] }
    })
    .reverse()
}

export async function POST(req: Request) {
  const body = (await req.json()) as ChatRequestBody & { messages: TutorUIMessage[]; settings?: unknown }
  const { messages, subject, mode, board, libraryId: rawLibraryId } = body
  const libraryId = isValidLibraryId(rawLibraryId) ? rawLibraryId : null
  // Model / provider / sampling choices from the Settings panel (validated; bad values fall back to defaults).
  const settings = parseSettings(body.settings)

  try {
    getModel("tutor", settings) // fail fast with a readable error when keys are missing
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }

  const vision = visionEnabled()
  const nativeVision = tutorSeesImages(settings)
  const snapshot = vision ? latestSnapshot(messages) : null
  const lastUser = messages.findLast((m) => m.role === "user")
  const last = messages.at(-1)
  const freshTurn = last?.role === "user"
  const freshSnapshot = freshTurn && !!last && last.parts.some(isSnapshot)
  // Images the student attached to their latest message (for look_closer and perception).
  const uploads = vision
    ? (lastUser?.parts.filter(isUpload) ?? []).map((p) => (p.type === "file" ? p.url : "")).filter(Boolean)
    : []
  const attachments = lastUser?.metadata?.attachments ?? []

  const stream = createUIMessageStream<TutorUIMessage>({
    originalMessages: messages,
    execute: async ({ writer }) => {
      const status = (label: string, stage: "perceive" | "think" = "perceive") =>
        writer.write({ type: "data-status", data: { stage, label }, transient: true })

      // Stage 1 — perception (only when the tutor model can't see images itself).
      let boardReading: string | null = null
      let imageReading: string | null = null
      if (!nativeVision && freshTurn) {
        const jobs: Promise<void>[] = []
        if (freshSnapshot && snapshot) {
          status("Looking at your board…")
          jobs.push(
            readBoard(snapshot, board, req.signal, settings)
              .then((r) => void (boardReading = r))
              .catch((e) => console.warn("[tutor] board reading failed:", (e as Error).message))
          )
        }
        if (uploads.length) {
          status(`Reading your image${uploads.length > 1 ? "s" : ""}…`)
          jobs.push(
            describeImages(uploads, req.signal, settings)
              .then((r) => void (imageReading = r))
              .catch((e) => console.warn("[tutor] image reading failed:", (e as Error).message))
          )
        }
        await Promise.all(jobs)
      }
      if (attachments.length) status("Reading your files…")
      const library = await librarySection(libraryId, freshTurn ? attachments : []).catch(() => "")
      status("Thinking…", "think")

      // Stage 2 — the tutor agent loop.
      const agent = createTutorAgent({
        subject,
        mode,
        board,
        boardReading,
        imageReading,
        library,
        libraryId,
        snapshot,
        images: uploads,
        plan: derivePlan(messages),
        settings,
      })
      const agentStream = await createAgentUIStream({
        agent,
        uiMessages: prepareMessages(messages, nativeVision && vision),
        abortSignal: req.signal,
        sendReasoning: settings.showReasoning,
        sendSources: true,
        // Tag the reply with what produced it (shown under the message).
        messageMetadata: ({ part }) =>
          part.type === "start"
            ? { model: modelId("tutor", settings), provider: providerFor(settings), effort: settings.reasoning }
            : undefined,
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
