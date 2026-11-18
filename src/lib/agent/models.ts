import "server-only"

import { createGroq } from "@ai-sdk/groq"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"

/**
 * Model roles in the pipeline. Every role can be overridden from the
 * environment.
 *
 *   tutor    – reasoning + tool calling, drives the agent loop
 *   vision   – reads the whiteboard snapshot (handwriting, sketches)
 *   research – web research sub-agent (web_search + web_fetch from the pi setup)
 *
 * Providers (TUTOR_PROVIDER):
 *   groq        – default; GROQ_API_KEY
 *   openrouter  – OPENROUTER_API_KEY
 *   any OpenAI-compatible endpoint – OPENAI_COMPATIBLE_BASE_URL (+ _API_KEY)
 */
export const DEFAULTS = {
  tutor: "openai/gpt-oss-120b",
  vision: "meta-llama/llama-4-scout-17b-16e-instruct",
  research: "openai/gpt-oss-20b",
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

type Provider = "groq" | "openrouter" | "custom"

function provider(): Provider {
  if (process.env.OPENAI_COMPATIBLE_BASE_URL?.trim()) return "custom"
  const wanted = process.env.TUTOR_PROVIDER?.trim().toLowerCase()
  if (wanted === "openrouter") return "openrouter"
  return "groq"
}

export const usingGroq = () => provider() === "groq"

function groq() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set. Copy .env.example to .env.local and add your key.")
  }
  return createGroq({ apiKey: process.env.GROQ_API_KEY })
}

function pick(role: keyof typeof DEFAULTS): string {
  const env = {
    tutor: process.env.TUTOR_MODEL,
    vision: process.env.VISION_MODEL,
    research: process.env.RESEARCH_MODEL,
  }[role]?.trim()
  if (env) return env
  if (provider() !== "groq") {
    // One model for every role unless told otherwise.
    const fallback = process.env.TUTOR_MODEL?.trim()
    if (!fallback) throw new Error(`Set TUTOR_MODEL when using the ${provider()} provider.`)
    return fallback
  }
  return DEFAULTS[role]
}

export const modelId = (role: keyof typeof DEFAULTS) => pick(role)

export function getModel(role: keyof typeof DEFAULTS): LanguageModel {
  // Test harness: scripted model, real everything else (see mock-model.ts).
  if (process.env.TUTOR_MOCK === "1") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("./mock-model") as typeof import("./mock-model")).mockModel(role)
  }
  const id = pick(role)
  switch (provider()) {
    case "openrouter":
      if (!process.env.OPENROUTER_API_KEY) {
        throw new Error("OPENROUTER_API_KEY is not set. Add it to .env.local (see .env.example).")
      }
      return createOpenAICompatible({
        name: "openrouter",
        baseURL: OPENROUTER_BASE_URL,
        apiKey: process.env.OPENROUTER_API_KEY,
        headers: { "X-Title": "Sketch tutor" },
      })(id)
    case "custom":
      return createOpenAICompatible({
        name: "custom",
        baseURL: process.env.OPENAI_COMPATIBLE_BASE_URL!.trim(),
        apiKey: process.env.OPENAI_COMPATIBLE_API_KEY,
      })(id)
    default:
      return groq()(id)
  }
}

/** True when the tutor model itself should receive board images (multimodal tutor). */
export function tutorSeesImages() {
  if (process.env.TUTOR_SEES_IMAGES) return process.env.TUTOR_SEES_IMAGES === "true"
  return pick("tutor") === pick("vision")
}

export function visionEnabled() {
  return process.env.TUTOR_VISION !== "false"
}
