import "server-only"

import { createGroq } from "@ai-sdk/groq"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { JSONValue, LanguageModel } from "ai"

import { DEFAULT_SETTINGS, PROVIDERS, type ProviderId, type ProviderStatus, type TutorSettings } from "./settings"

/**
 * Model roles in the pipeline:
 *   tutor    – reasoning + tool calling, drives the agent loop
 *   vision   – reads the whiteboard, attached images and PDF pages
 *   research – web research sub-agent (web_search + web_fetch from the pi setup)
 *
 * Providers (keys only ever come from the environment):
 *   groq        – GROQ_API_KEY
 *   openrouter  – OPENROUTER_API_KEY
 *   custom      – OPENAI_COMPATIBLE_BASE_URL (+ OPENAI_COMPATIBLE_API_KEY)
 *
 * The server's defaults come from the env (TUTOR_PROVIDER, TUTOR_MODEL, …);
 * the settings sent with a request can pick another configured provider and
 * other models.
 */
export type Role = "tutor" | "vision" | "research"

const GROQ_DEFAULTS = {
  tutor: "openai/gpt-oss-120b",
  vision: "meta-llama/llama-4-scout-17b-16e-instruct",
  research: "openai/gpt-oss-20b",
}
const OPENROUTER_DEFAULT = "deepseek/deepseek-v4.1-flash"
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

export function isConfigured(provider: ProviderId) {
  if (provider === "groq") return !!process.env.GROQ_API_KEY
  if (provider === "openrouter") return !!process.env.OPENROUTER_API_KEY
  return !!process.env.OPENAI_COMPATIBLE_BASE_URL?.trim()
}

/** The provider configured in the environment. */
export function envProvider(): ProviderId {
  if (process.env.OPENAI_COMPATIBLE_BASE_URL?.trim()) return "custom"
  if (process.env.TUTOR_PROVIDER?.trim().toLowerCase() === "openrouter") return "openrouter"
  return "groq"
}

/** Provider for a request: the one chosen in settings if it's configured, else the env's. */
export function providerFor(settings: TutorSettings = DEFAULT_SETTINGS): ProviderId {
  return settings.provider && isConfigured(settings.provider) ? settings.provider : envProvider()
}

/** Default models for a provider (env overrides apply to the env's own provider). */
export function defaultModels(provider: ProviderId) {
  const env = provider === envProvider()
  const tutorEnv = env ? process.env.TUTOR_MODEL?.trim() : undefined
  const pickEnv = (key: string) => (env ? process.env[key]?.trim() : undefined)
  if (provider === "groq") {
    return {
      tutor: tutorEnv || GROQ_DEFAULTS.tutor,
      vision: pickEnv("VISION_MODEL") || GROQ_DEFAULTS.vision,
      research: pickEnv("RESEARCH_MODEL") || GROQ_DEFAULTS.research,
    }
  }
  const tutor = tutorEnv || (provider === "openrouter" ? OPENROUTER_DEFAULT : "")
  return {
    tutor,
    vision: pickEnv("VISION_MODEL") || tutor,
    research: pickEnv("RESEARCH_MODEL") || tutor,
  }
}

export function providerStatuses(): ProviderStatus[] {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    keyEnv: p.keyEnv,
    configured: isConfigured(p.id),
    defaults: defaultModels(p.id),
  }))
}

/** Model id for a role under the given settings. */
export function modelId(role: Role, settings: TutorSettings = DEFAULT_SETTINGS) {
  const provider = providerFor(settings)
  // Settings only apply when they target the provider actually in use.
  const chosen = provider === (settings.provider ?? envProvider()) ? settings.models : { tutor: "", vision: "", research: "" }
  const defaults = defaultModels(provider)
  const tutor = chosen.tutor || defaults.tutor
  if (role === "tutor") return tutor
  if (chosen[role]) return chosen[role]
  // A custom tutor model on a single-model provider drives the other roles too.
  if (provider !== "groq" && chosen.tutor) return tutor
  return defaults[role] || tutor
}

export function getModel(role: Role, settings: TutorSettings = DEFAULT_SETTINGS): LanguageModel {
  // Test harness: scripted model, real everything else (see mock-model.ts).
  if (process.env.TUTOR_MOCK === "1") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("./mock-model") as typeof import("./mock-model")).mockModel(role)
  }
  const provider = providerFor(settings)
  const id = modelId(role, settings)
  if (!id) throw new Error(`No model set for ${provider}. Choose one in Settings or set TUTOR_MODEL.`)
  switch (provider) {
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
      if (!process.env.GROQ_API_KEY) {
        throw new Error("GROQ_API_KEY is not set. Copy .env.example to .env.local and add your key.")
      }
      return createGroq({ apiKey: process.env.GROQ_API_KEY })(id)
  }
}

export const usingGroq = (settings?: TutorSettings) => providerFor(settings) === "groq"

/** True when the tutor model itself should receive board images (multimodal tutor). */
export function tutorSeesImages(settings: TutorSettings = DEFAULT_SETTINGS) {
  if (process.env.TUTOR_SEES_IMAGES) return process.env.TUTOR_SEES_IMAGES === "true"
  return modelId("tutor", settings) === modelId("vision", settings)
}

export function visionEnabled() {
  return process.env.TUTOR_VISION !== "false"
}

/**
 * Call settings for a model call: sampling, the standard `reasoning` level,
 * and provider-specific extras. Unset values are left to the model.
 */
export function callSettings(settings: TutorSettings = DEFAULT_SETTINGS, role: Role = "tutor") {
  const provider = providerFor(settings)
  const s = settings.sampling
  const num = (v: number | null | undefined) => (v === null || v === undefined ? undefined : v)
  // Vision/research calls keep their own output budget; sampling applies to the tutor.
  const sampling =
    role === "tutor"
      ? {
          temperature: num(s.temperature),
          topP: num(s.topP),
          topK: provider === "groq" ? undefined : num(s.topK),
          presencePenalty: num(s.presencePenalty),
          frequencyPenalty: num(s.frequencyPenalty),
          maxOutputTokens: num(s.maxOutputTokens),
          seed: num(s.seed),
        }
      : {}

  const providerOptions: Record<string, Record<string, JSONValue>> = {}
  let reasoning: TutorSettings["reasoning"] | undefined = settings.reasoning === "provider-default" ? undefined : settings.reasoning

  if (provider === "openrouter") {
    // OpenRouter's own request fields are passed straight into the body.
    const o: Record<string, JSONValue> = {}
    // OpenRouter's unified reasoning object accepts every level ("none" disables reasoning);
    // `exclude` keeps reasoning out of the response when the student hides it.
    const r: Record<string, JSONValue> = {}
    if (reasoning) r.effort = reasoning
    if (!settings.showReasoning && reasoning !== "none") r.exclude = true
    if (Object.keys(r).length) o.reasoning = r
    reasoning = undefined
    if (role === "tutor") {
      if (s.minP != null) o.min_p = s.minP
      if (s.repetitionPenalty != null) o.repetition_penalty = s.repetitionPenalty
    }
    const routing: Record<string, JSONValue> = {}
    if (settings.openrouter.sort !== "default") routing.sort = settings.openrouter.sort
    if (!settings.openrouter.allowFallbacks) routing.allow_fallbacks = false
    if (settings.openrouter.dataCollection === "deny") routing.data_collection = "deny"
    if (Object.keys(routing).length) o.provider = routing
    if (Object.keys(o).length) providerOptions.openrouter = o
  }
  if (provider === "groq" && settings.groq.serviceTier !== "default") {
    providerOptions.groq = { serviceTier: settings.groq.serviceTier }
  }

  return {
    ...sampling,
    ...(reasoning ? { reasoning } : {}),
    ...(Object.keys(providerOptions).length ? { providerOptions } : {}),
  }
}
