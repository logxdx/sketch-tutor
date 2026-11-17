import "server-only"

import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { resolveKey } from "./keys"

/**
 * Web search over several providers with automatic fallback.
 * Ported from the pi agent's web-search extension (~/.pi/agent/extensions/web-search).
 *
 * | Order | Provider   | Key                | Notes                                   |
 * |-------|------------|--------------------|-----------------------------------------|
 * | 1     | TinyFish   | TINYFISH_API_KEY   | free: 30 req/min, 500/hour              |
 * | 2     | LangSearch | LANGSEARCH_API_KEY | free                                    |
 * | 3     | Exa        | EXA_API_KEY        | paid ($4 / 1k, `instant`)               |
 * | 4     | ddgs       | none               | keyless metasearch via Python venv      |
 * | 5     | Wikipedia  | none               | keyless encyclopedia fallback (added)   |
 *
 * Reorder or drop with WEB_SEARCH_PROVIDERS="exa,ddgs" (PI_WEB_SEARCH_PROVIDERS also works).
 */

export type Recency = "day" | "week" | "month" | "year"

export interface SearchRequest {
  query: string
  count: number
  countRequested?: boolean
  includeDomains?: string[]
  excludeDomains?: string[]
  recency?: Recency
  signal?: AbortSignal
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
  date?: string
}

interface SearchProvider {
  name: string
  keyEnv?: string
  search(req: SearchRequest, key: string | undefined): Promise<SearchResult[]>
}

class ProviderError extends Error {}

const TIMEOUT_MS = 20000
const RECENCY_DAYS: Record<Recency, number> = { day: 1, week: 7, month: 30, year: 365 }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function request(url: string, init: RequestInit, signal?: AbortSignal): Promise<any> {
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(signal ? [signal] : [])]),
    })
  } catch (err) {
    throw new ProviderError(err instanceof Error ? err.message : String(err))
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200)
    throw new ProviderError(`HTTP ${res.status} ${body}`)
  }
  return res.json()
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** https://docs.tinyfish.ai/search-api/reference — free; daily allowance, 30 req/min. */
const tinyfish: SearchProvider = {
  name: "tinyfish",
  keyEnv: "TINYFISH_API_KEY",
  async search(req, key) {
    const url = new URL("https://api.search.tinyfish.ai")
    url.searchParams.set("query", req.query)
    if (req.includeDomains?.length) url.searchParams.set("include_domains", req.includeDomains.join(","))
    if (req.excludeDomains?.length) url.searchParams.set("exclude_domains", req.excludeDomains.join(","))
    if (req.recency) url.searchParams.set("recency_minutes", String(RECENCY_DAYS[req.recency] * 1440))
    const data = await request(url.toString(), { headers: { "X-API-Key": key! } }, req.signal)
    return ((data.results ?? []) as any[]).slice(0, req.count).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.snippet ?? "",
      date: r.date ?? undefined,
    }))
  },
}

/** https://langsearch.com — free. */
const langsearch: SearchProvider = {
  name: "langsearch",
  keyEnv: "LANGSEARCH_API_KEY",
  async search(req, key) {
    const freshness = { day: "oneDay", week: "oneWeek", month: "oneMonth", year: "oneYear" } as const
    const data = await request(
      "https://api.langsearch.com/v1/web-search",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: req.query,
          count: req.count,
          ...(req.includeDomains?.length && { includeDomains: req.includeDomains }),
          ...(req.excludeDomains?.length && { excludeDomains: req.excludeDomains }),
          ...(req.recency && { freshness: freshness[req.recency] }),
        }),
      },
      req.signal
    )
    return ((data?.data?.webPages?.value ?? []) as any[]).map((p) => ({
      title: p.name ?? "",
      url: p.url ?? "",
      snippet: p.snippet ?? p.text ?? "",
      date: p.datePublished ?? undefined,
    }))
  },
}

/** Exa /search: query + highlights, `instant` for tool latency. */
const exa: SearchProvider = {
  name: "exa",
  keyEnv: "EXA_API_KEY",
  async search(req, key) {
    const since = req.recency
      ? new Date(Date.now() - RECENCY_DAYS[req.recency] * 86400000).toISOString()
      : undefined
    const data = await request(
      "https://api.exa.ai/search",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: req.query,
          type: "instant",
          // Exa's guidance: omit numResults (default 10) unless a count was asked for
          ...(req.countRequested && { numResults: req.count }),
          contents: { highlights: true },
          ...(req.includeDomains?.length && { includeDomains: req.includeDomains }),
          ...(req.excludeDomains?.length && { excludeDomains: req.excludeDomains }),
          ...(since && { startPublishedDate: since }),
        }),
      },
      req.signal
    )
    return ((data.results ?? []) as any[]).slice(0, req.count).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: (r.highlights ?? []).join(" … ") || (r.text ?? ""),
      date: r.publishedDate ?? undefined,
    }))
  },
}

/** Python for ddgs: DDGS_PYTHON, the pi extension's venv, or ./.venv in this project. */
function ddgsPython() {
  const candidates = [
    process.env.DDGS_PYTHON,
    join(homedir(), ".pi", "agent", "extensions", "web-search", ".venv", "bin", "python"),
    join(process.cwd(), ".venv", "bin", "python"),
  ].filter((p): p is string => !!p)
  return candidates.find((p) => existsSync(p))
}

/** Keyless metasearch (DuckDuckGo, Bing, Brave, …) via the ddgs Python package. */
const ddgs: SearchProvider = {
  name: "ddgs",
  async search(req) {
    const python = ddgsPython()
    if (!python) throw new ProviderError("ddgs not installed (see README: Web search)")
    const script = join(process.cwd(), "scripts", "ddgs_search.py")
    const query = [
      req.query,
      ...(req.includeDomains ?? []).map((d) => `site:${d}`),
      ...(req.excludeDomains ?? []).map((d) => `-site:${d}`),
    ].join(" ")
    const timelimit = req.recency ? req.recency[0] : ""
    // Backends rotate per call, so an empty answer is often transient: retry once.
    for (let attempt = 0; attempt < 2; attempt++) {
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          python,
          [script, query, String(req.count), timelimit],
          { signal: req.signal, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
          (err, out, stderr) =>
            err ? reject(new ProviderError(stderr.trim().split("\n").pop() || err.message)) : resolve(out)
        )
      })
      const results = JSON.parse(stdout) as SearchResult[]
      if (results.length) return results
    }
    return []
  },
}

/** Keyless last resort so the tutor can always cite something. */
const wikipedia: SearchProvider = {
  name: "wikipedia",
  async search(req) {
    const ua = process.env.WIKIMEDIA_USER_AGENT || "SketchTutor/0.1 (open-source educational whiteboard app)"
    const data = await request(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${req.count}&srsearch=${encodeURIComponent(req.query)}`,
      { headers: { "User-Agent": ua } },
      req.signal
    )
    return ((data?.query?.search ?? []) as any[]).map((r) => ({
      title: `${r.title} — Wikipedia`,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(r.title).replace(/ /g, "_"))}`,
      snippet: String(r.snippet ?? "").replace(/<[^>]+>/g, ""),
      date: r.timestamp ?? undefined,
    }))
  },
}

/* eslint-enable @typescript-eslint/no-explicit-any */

const PROVIDERS: SearchProvider[] = [tinyfish, langsearch, exa, ddgs, wikipedia]

export interface SearchOutcome {
  provider: string
  results: SearchResult[]
  /** Providers skipped or failed before the one that answered. */
  skipped: string[]
}

export async function searchWithFallback(req: SearchRequest): Promise<SearchOutcome> {
  const order = (process.env.WEB_SEARCH_PROVIDERS ?? process.env.PI_WEB_SEARCH_PROVIDERS)
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const providers = order ? PROVIDERS.filter((p) => order.includes(p.name)) : PROVIDERS
  if (order) providers.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))

  const skipped: string[] = []
  for (const provider of providers) {
    if (req.signal?.aborted) throw new Error("Aborted")
    const key = provider.keyEnv ? await resolveKey(provider.keyEnv) : undefined
    if (provider.keyEnv && !key) {
      skipped.push(`${provider.name}: no ${provider.keyEnv}`)
      continue
    }
    try {
      const results = await provider.search(req, key)
      if (results.length) return { provider: provider.name, results, skipped }
      skipped.push(`${provider.name}: no results`)
    } catch (err) {
      skipped.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error(`All search providers failed:\n  ${skipped.join("\n  ")}`)
}

export function normalizeDomain(value: string): string {
  let domain = value.trim().replace(/^site:/i, "")
  try {
    domain = new URL(/^[a-z]+:\/\//i.test(domain) ? domain : `https://${domain}`).hostname
  } catch {}
  return domain.replace(/^www\./, "")
}
