import "server-only"

import { generateText, isStepCount, ToolLoopAgent } from "ai"

import { createLibraryTools } from "@/lib/context/tools"
import { clientTools } from "./client-tools"
import { getModel, modelId, usingGroq } from "./models"
import { buildInstructions } from "./prompt"
import { createServerTools } from "./server-tools"
import type { Mode, Subject } from "./types"

/**
 * Stage 1 of the pipeline — perception. A vision model reads the latest
 * picture of the whiteboard (handwriting, sketches, the student's answer) and
 * reports it as text for the reasoning model.
 */
export async function readBoard(snapshot: string, boardText: string | null | undefined, signal?: AbortSignal) {
  const { text } = await generateText({
    model: getModel("vision"),
    abortSignal: signal,
    maxOutputTokens: 700,
    messages: [
      {
        role: "user",
        content: [
          { type: "file", data: new URL(snapshot), mediaType: "image/jpeg" },
          {
            type: "text",
            text: `You are the eyes of a tutor. This is the shared whiteboard. Element list for reference (S = student, T = tutor):
${boardText || "(none)"}

Describe what is on the board for the tutor, focusing on the STUDENT's work (S elements, freehand strokes, handwriting):
- Transcribe all handwriting and written maths exactly (use Unicode/LaTeX for maths).
- Describe sketches/diagrams and what they seem to represent; mention element ids where you can match them.
- Point out anything that looks incorrect or unfinished.
Be concise: bullet points, no preamble.`,
          },
        ],
      },
    ],
  })
  return text.trim()
}

/** Perception for photos/screenshots the student attached (when the tutor model can't see images). */
export async function describeImages(images: string[], signal?: AbortSignal) {
  const { text } = await generateText({
    model: getModel("vision"),
    abortSignal: signal,
    maxOutputTokens: 900,
    messages: [
      {
        role: "user",
        content: [
          ...images.map((url) => ({ type: "file" as const, data: new URL(url), mediaType: url.slice(5, url.indexOf(";")) || "image/jpeg" })),
          {
            type: "text" as const,
            text: `You are the eyes of a tutor. The student attached ${images.length > 1 ? "these images" : "this image"} (photo of homework, textbook page, diagram, screenshot…). For each image (number them), transcribe all text and maths exactly (LaTeX for maths) and describe any figures, graphs or diagrams precisely enough to teach from. Bullet points, no preamble.`,
          },
        ],
      },
    ],
  })
  return text.trim()
}

/**
 * Stage 2 — the tutor agent. A tool loop on the reasoning model with server
 * tools (research, images, maths, vision, rich media) that run inline, and
 * client tools (whiteboard, quiz) that pause the loop for the browser.
 */
export function createTutorAgent(opts: {
  subject?: Subject
  mode?: Mode
  board?: string | null
  boardReading?: string | null
  imageReading?: string | null
  library?: string
  libraryId: string | null
  snapshot: string | null
  images: string[]
}) {
  const id = modelId("tutor")
  const reasoning = usingGroq() && /gpt-oss|qwen3|deepseek-r1/i.test(id)
  return new ToolLoopAgent({
    model: getModel("tutor"),
    instructions: buildInstructions(opts),
    tools: {
      ...clientTools,
      ...createServerTools({ snapshot: opts.snapshot, images: opts.images }),
      ...createLibraryTools(opts.libraryId),
    },
    stopWhen: isStepCount(16),
    temperature: reasoning ? undefined : 0.4,
    providerOptions: reasoning ? { groq: { reasoningEffort: "medium" } } : undefined,
  })
}
