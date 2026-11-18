import "server-only"

import { isStepCount, ToolLoopAgent } from "ai"

import { createLibraryTools } from "@/lib/context/tools"
import { clientTools } from "./client-tools"
import { callSettings, getModel, modelId, usingGroq } from "./models"
import type { LessonPlan } from "./plan"
import { createPlanTools } from "./plan-tools"
import { buildInstructions } from "./prompt"
import { createServerTools } from "./server-tools"
import type { TutorSettings } from "./settings"
import type { Mode, Subject } from "./types"
import { askVision, fromDataUrl } from "./vision"

/**
 * Stage 1 of the pipeline — perception. A vision model reads the latest
 * picture of the whiteboard (handwriting, sketches, the student's answer) and
 * reports it as text for the reasoning model.
 */
export async function readBoard(
  snapshot: string,
  boardText: string | null | undefined,
  signal?: AbortSignal,
  settings?: TutorSettings
) {
  return askVision(
    [fromDataUrl(snapshot)],
    `You are the eyes of a tutor. This is the shared whiteboard. Element list for reference (S = student, T = tutor):
${boardText || "(none)"}

Describe what is on the board for the tutor, focusing on the STUDENT's work (S elements, freehand strokes, handwriting):
- Transcribe all handwriting and written maths exactly (use Unicode/LaTeX for maths).
- Describe sketches/diagrams and what they seem to represent; mention element ids where you can match them.
- Point out anything that looks incorrect or unfinished.
Be concise: bullet points, no preamble.`,
    signal,
    settings
  )
}

/** Perception for photos/screenshots the student attached (when the tutor model can't see images). */
export async function describeImages(images: string[], signal?: AbortSignal, settings?: TutorSettings) {
  return askVision(
    images.map(fromDataUrl),
    `You are the eyes of a tutor. The student attached ${images.length > 1 ? "these images" : "this image"} (photo of homework, textbook page, diagram, screenshot…). For each image (number them), transcribe all text and maths exactly (LaTeX for maths) and describe any figures, graphs or diagrams precisely enough to teach from. Bullet points, no preamble.`,
    signal,
    settings
  )
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
  plan: LessonPlan | null
  settings: TutorSettings
}) {
  const { settings } = opts
  const call = callSettings(settings, "tutor")
  // Groq's reasoning models default to medium effort unless the student picked a level.
  const groqReasoningModel = usingGroq(settings) && /gpt-oss|qwen3|deepseek-r1/i.test(modelId("tutor", settings))
  const groqDefaults =
    groqReasoningModel && !call.reasoning && !call.providerOptions?.groq
      ? { providerOptions: { groq: { reasoningEffort: "medium" } } }
      : {}

  const serverTools = createServerTools({ snapshot: opts.snapshot, images: opts.images, settings })
  if (!settings.agent.webAccess) {
    // No internet: drop web search, page fetching, research and image search.
    for (const name of WEB_TOOLS) delete (serverTools as Record<string, unknown>)[name]
  }

  return new ToolLoopAgent({
    ...groqDefaults,
    ...call,
    model: getModel("tutor", settings),
    instructions: buildInstructions({ ...opts, webAccess: settings.agent.webAccess }),
    tools: {
      ...clientTools,
      ...serverTools,
      ...createPlanTools(opts.plan),
      ...createLibraryTools(opts.libraryId, settings),
    },
    stopWhen: isStepCount(settings.agent.maxSteps),
  })
}

const WEB_TOOLS = ["web_search", "web_fetch", "research", "find_images"]
