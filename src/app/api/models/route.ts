import { isConfigured } from "@/lib/agent/models"
import type { ModelInfo, ProviderId } from "@/lib/agent/settings"

/** A provider's model catalog with capabilities, cached for 10 minutes. */
const cache = new Map<ProviderId, { at: number; models: ModelInfo[] }>()
const TTL = 10 * 60 * 1000

type OpenRouterModel = {
  id: string
  name: string
  context_length?: number
  architecture?: { input_modalities?: string[] }
  supported_parameters?: string[]
  pricing?: { prompt?: string; completion?: string }
}

async function openrouterModels(): Promise<ModelInfo[]> {
  // Public endpoint: capabilities, parameters and prices for every model.
  const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`OpenRouter models: HTTP ${res.status}`)
  const { data } = (await res.json()) as { data: OpenRouterModel[] }
  return data
    .filter((m) => !m.id.endsWith(":batch"))
    .map((m) => {
      const params = m.supported_parameters ?? []
      const perM = (v?: string) => (v ? Math.round(Number(v) * 1e6 * 1000) / 1000 : NaN)
      const input = perM(m.pricing?.prompt)
      const output = perM(m.pricing?.completion)
      return {
        id: m.id,
        name: m.name,
        provider: "openrouter" as const,
        context: m.context_length,
        vision: m.architecture?.input_modalities?.includes("image") ?? null,
        tools: params.includes("tools"),
        reasoning: params.includes("reasoning") || params.includes("include_reasoning"),
        params,
        // Routers report -1 ("varies"): leave the price out rather than show a nonsense number.
        price: Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0 ? { input, output } : undefined,
      }
    })
}

/** OpenAI-style /models listing (Groq and custom endpoints): ids only, capabilities guessed from names. */
async function openaiStyleModels(provider: ProviderId, baseURL: string, apiKey?: string): Promise<ModelInfo[]> {
  const res = await fetch(`${baseURL.replace(/\/$/, "")}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`${provider} models: HTTP ${res.status}`)
  const { data } = (await res.json()) as { data: { id: string; context_window?: number; active?: boolean }[] }
  return data
    .filter((m) => m.active !== false && !/whisper|tts|guard|embed|playai|orpheus/i.test(m.id))
    .map((m) => ({
      id: m.id,
      name: m.id,
      provider,
      context: m.context_window,
      vision: /llama-4|vision|-vl|pixtral|gemma-3|qwen.*vl/i.test(m.id) ? true : null,
      tools: null,
      reasoning: /gpt-oss|qwen3|deepseek-r1|qwq|reason/i.test(m.id) ? true : null,
    }))
}

export async function GET(req: Request) {
  const provider = new URL(req.url).searchParams.get("provider") as ProviderId | null
  if (provider !== "groq" && provider !== "openrouter" && provider !== "custom") {
    return Response.json({ error: "Unknown provider" }, { status: 400 })
  }
  if (!isConfigured(provider)) return Response.json({ models: [], configured: false })

  const hit = cache.get(provider)
  if (hit && Date.now() - hit.at < TTL) return Response.json({ models: hit.models, configured: true })
  try {
    const models =
      provider === "openrouter"
        ? await openrouterModels()
        : provider === "groq"
          ? await openaiStyleModels("groq", "https://api.groq.com/openai/v1", process.env.GROQ_API_KEY)
          : await openaiStyleModels("custom", process.env.OPENAI_COMPATIBLE_BASE_URL!.trim(), process.env.OPENAI_COMPATIBLE_API_KEY)
    cache.set(provider, { at: Date.now(), models })
    return Response.json({ models, configured: true })
  } catch (e) {
    return Response.json({ models: [], configured: true, error: (e as Error).message }, { status: 502 })
  }
}
