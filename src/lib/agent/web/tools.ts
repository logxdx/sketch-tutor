import "server-only"

import { isStepCount, tool, ToolLoopAgent } from "ai"
import { z } from "zod"

import { getModel } from "../models"
import { fetchAndExtract } from "./fetch"
import { normalizeDomain, searchWithFallback } from "./search"

const SNIPPET_CHARS = 500
const FETCH_CHARS_FOR_MODEL = 14000

export type WebSource = { n: number; title: string; url: string; snippet?: string; date?: string }

export const webSearchTool = tool({
  description:
    "Search the web. Returns title, URL, date and snippet per result (numbered, so you can cite them as [1], [2]). One search angle per call; rephrase rather than repeating a query. Then web_fetch the one or two best URLs if you need the full text.",
  inputSchema: z.object({
    query: z.string().describe("Search query in plain words"),
    count: z.number().int().min(1).max(10).optional().describe("Number of results (default 5)"),
    site: z.string().optional().describe("Only results from this domain, e.g. nasa.gov"),
    exclude_sites: z.array(z.string()).optional(),
    recency: z.enum(["day", "week", "month", "year"]).optional().describe("Only results published within this period"),
  }),
  execute: async (params, { abortSignal }) => {
    const query = params.query.trim()
    const outcome = await searchWithFallback({
      query,
      count: Math.min(Math.max(Math.round(params.count ?? 5), 1), 10),
      countRequested: params.count !== undefined,
      includeDomains: params.site ? [normalizeDomain(params.site)] : undefined,
      excludeDomains: params.exclude_sites?.map(normalizeDomain).filter(Boolean),
      recency: params.recency,
      signal: abortSignal,
    })
    const results: WebSource[] = outcome.results.map((r, i) => {
      let snippet = r.snippet.replace(/\s+/g, " ").trim()
      if (snippet.length > SNIPPET_CHARS) snippet = `${snippet.slice(0, SNIPPET_CHARS)}…`
      return { n: i + 1, title: r.title, url: r.url, snippet, date: r.date?.slice(0, 10) }
    })
    return { query, provider: outcome.provider, results, skipped: outcome.skipped }
  },
})

export const webFetchTool = tool({
  description:
    "Fetch a web page (or PDF) and extract its readable content as markdown. Use on the most relevant search results, or on a URL the student shares.",
  inputSchema: z.object({ url: z.string().describe("URL to fetch") }),
  execute: async ({ url }, { abortSignal }) => {
    const result = await fetchAndExtract(url, abortSignal)
    if (result.error) throw new Error(`${url}: ${result.error}`)
    const truncated = result.content.length > FETCH_CHARS_FOR_MODEL
    return {
      url: result.url,
      title: result.title,
      via: result.via,
      chars: result.content.length,
      content: truncated
        ? `${result.content.slice(0, FETCH_CHARS_FOR_MODEL)}\n\n[… truncated, ${result.content.length - FETCH_CHARS_FOR_MODEL} more characters]`
        : result.content,
    }
  },
})

/** Adapted from the pi "researcher" agent (~/.pi/agent/agents/researcher.md). */
const RESEARCHER_INSTRUCTIONS = `You are a research specialist working for a tutor. Given a question, research the web and produce a focused, well-sourced brief the tutor can teach from.

Process:
1. Break the question into 2-4 searchable facets.
2. Search with web_search using varied angles: the direct answer; authoritative sources (official, primary documents, data, reference works); recent developments only if time-sensitive.
3. Read the results; note what is well covered and what has gaps.
4. web_fetch the 2-3 most promising URLs for full content.
5. If gaps remain, search again with refined queries.

Keep primary/official sources over blogs and forums, recent over stale, on-topic over tangential. Drop SEO filler and outdated info.

Your FINAL message is the whole deliverable and must stand alone:
## Summary
3-8 bullet points with the key facts, figures, dates and definitions, each citing sources like [1].
## Sources
1. Title — URL
2. Title — URL
Only list sources you actually used. Never invent URLs.`

export function createResearchTool() {
  return tool({
    description:
      "Deep research by a sub-agent that searches the web from several angles, reads the best pages and returns a sourced brief. Use for questions that need several sources or current facts; use web_search for a single quick lookup.",
    inputSchema: z.object({
      question: z.string().describe("What to find out, with any context that matters (level, focus)."),
    }),
    execute: async ({ question }, { abortSignal }) => {
      const sources = new Map<string, WebSource>()
      const researcher = new ToolLoopAgent({
        model: getModel("research"),
        instructions: RESEARCHER_INSTRUCTIONS,
        tools: { web_search: webSearchTool, web_fetch: webFetchTool },
        stopWhen: isStepCount(10),
        onStepEnd: ({ toolResults }) => {
          for (const r of toolResults ?? []) {
            if (r.toolName === "web_search") {
              for (const s of (r.output as { results: WebSource[] }).results ?? []) {
                if (!sources.has(s.url)) sources.set(s.url, { ...s, n: sources.size + 1 })
              }
            }
          }
        },
      })
      const result = await researcher.generate({ prompt: question, abortSignal })
      const brief = result.text.trim()
      // Prefer the sources the brief actually lists; fall back to what was searched.
      const listed = [...brief.matchAll(/^\s*(\d+)\.\s+(.+?)\s+[—-]\s+(https?:\/\/\S+)\s*$/gm)].map((m) => ({
        n: Number(m[1]),
        title: m[2].trim(),
        url: m[3].replace(/[).,]+$/, ""),
        snippet: sources.get(m[3])?.snippet,
      }))
      return {
        question,
        brief: brief.split(/\n##\s*Sources/i)[0].replace(/^##\s*Summary\s*/i, "").trim(),
        sources: listed.length ? listed : [...sources.values()].slice(0, 8),
        steps: result.steps.length,
      }
    },
  })
}
