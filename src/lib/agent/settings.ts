import { z } from "zod"

/**
 * Tutor settings chosen in the UI and sent with every chat request. Shared by
 * client and server. API keys are never part of this — they stay in the
 * server's environment.
 */

export const PROVIDERS = [
  { id: "groq", label: "Groq", keyEnv: "GROQ_API_KEY" },
  { id: "openrouter", label: "OpenRouter", keyEnv: "OPENROUTER_API_KEY" },
  { id: "custom", label: "OpenAI-compatible", keyEnv: "OPENAI_COMPATIBLE_BASE_URL" },
] as const
export type ProviderId = (typeof PROVIDERS)[number]["id"]

/** AI SDK v7 standard reasoning levels (providers map them to their own effort settings). */
export const REASONING_LEVELS = [
  { value: "provider-default", label: "Default", hint: "Whatever the model does by default" },
  { value: "none", label: "Off", hint: "No thinking (fastest)" },
  { value: "minimal", label: "Minimal", hint: "" },
  { value: "low", label: "Low", hint: "Quick answers" },
  { value: "medium", label: "Medium", hint: "Balanced" },
  { value: "high", label: "High", hint: "Thorough reasoning" },
  { value: "xhigh", label: "Extra high", hint: "" },
  { value: "max", label: "Max", hint: "Slowest, most careful" },
] as const
export type ReasoningLevel = (typeof REASONING_LEVELS)[number]["value"]

const modelId = z.string().trim().max(200).regex(/^[\w.:/@+~-]*$/, "Invalid model id")
const opt = (schema: z.ZodNumber) => schema.optional().nullable()

export const settingsSchema = z.object({
  /** null = the server's configured provider (TUTOR_PROVIDER / env). */
  provider: z.enum(["groq", "openrouter", "custom"]).nullable().default(null),
  models: z
    .object({
      /** Empty = the server default for this provider. */
      tutor: modelId.default(""),
      /** Empty = same as the tutor model when it can see images, else the server default. */
      vision: modelId.default(""),
      research: modelId.default(""),
    })
    .default({ tutor: "", vision: "", research: "" }),
  reasoning: z
    .enum(["provider-default", "none", "minimal", "low", "medium", "high", "xhigh", "max"])
    .default("provider-default"),
  showReasoning: z.boolean().default(true),
  sampling: z
    .object({
      temperature: opt(z.number().min(0).max(2)),
      topP: opt(z.number().min(0).max(1)),
      topK: opt(z.number().int().min(1).max(500)),
      minP: opt(z.number().min(0).max(1)),
      presencePenalty: opt(z.number().min(-2).max(2)),
      frequencyPenalty: opt(z.number().min(-2).max(2)),
      repetitionPenalty: opt(z.number().min(0).max(2)),
      maxOutputTokens: opt(z.number().int().min(256).max(128000)),
      seed: opt(z.number().int().min(0).max(2 ** 31 - 1)),
    })
    .default({}),
  agent: z
    .object({
      maxSteps: z.number().int().min(1).max(40).default(16),
      webAccess: z.boolean().default(true),
      /** Browser-side: how many times the chat continues on its own after board tools. */
      autoContinue: z.number().int().min(0).max(30).default(12),
    })
    .default({ maxSteps: 16, webAccess: true, autoContinue: 12 }),
  openrouter: z
    .object({
      sort: z.enum(["default", "price", "throughput", "latency"]).default("default"),
      allowFallbacks: z.boolean().default(true),
      dataCollection: z.enum(["allow", "deny"]).default("allow"),
    })
    .default({ sort: "default", allowFallbacks: true, dataCollection: "allow" }),
  groq: z
    .object({ serviceTier: z.enum(["default", "on_demand", "flex", "auto"]).default("default") })
    .default({ serviceTier: "default" }),
})

export type TutorSettings = z.infer<typeof settingsSchema>
export const DEFAULT_SETTINGS: TutorSettings = settingsSchema.parse({})

/** Parse untrusted settings; anything invalid falls back to defaults rather than failing the request. */
export function parseSettings(input: unknown): TutorSettings {
  const result = settingsSchema.safeParse(input ?? {})
  return result.success ? result.data : DEFAULT_SETTINGS
}

/** What the server reports about providers (no secrets). */
export type ProviderStatus = {
  id: ProviderId
  label: string
  configured: boolean
  keyEnv: string
  defaults: { tutor: string; vision: string; research: string }
}

export type SettingsInfo = { active: ProviderId; providers: ProviderStatus[] }

/** One entry of a provider's model catalog. Capabilities are null when the provider doesn't say. */
export type ModelInfo = {
  id: string
  name: string
  provider: ProviderId
  context?: number
  vision: boolean | null
  tools: boolean | null
  reasoning: boolean | null
  /** Request parameters the model accepts (OpenRouter reports these). */
  params?: string[]
  /** USD per million tokens. */
  price?: { input: number; output: number }
}
