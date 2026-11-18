import "server-only"

import { generateText, tool } from "ai"
import { z } from "zod"

import { getModel } from "./models"
import { chartInput, exploreInput, show3dInput, suggestRepliesInput } from "./schemas"
import { createResearchTool, webFetchTool, webSearchTool } from "./web/tools"

export type { WebSource } from "./web/tools"

const UA = process.env.WIKIMEDIA_USER_AGENT || "SketchTutor/0.1 (open-source educational whiteboard app)"

export type ImageResult = {
  title: string
  url: string
  thumb: string
  page: string
  license?: string
  author?: string
  width?: number
  height?: number
}

const stripHtml = (s?: string) => s?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()

async function getJSON<T>(url: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    ...init,
    signal,
    headers: { "User-Agent": UA, Accept: "application/json", ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`)
  return (await res.json()) as T
}

// -------------------------------------------------------------- images

export async function findImages(query: string, count = 6, signal?: AbortSignal): Promise<ImageResult[]> {
  const url =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6" +
    `&gsrlimit=${Math.min(12, count * 2)}&gsrsearch=${encodeURIComponent(`${query} filetype:bitmap|drawing`)}` +
    "&prop=imageinfo&iiprop=url|extmetadata|mime|size&iiurlwidth=900"
  const data = await getJSON<{
    query?: {
      pages: Record<
        string,
        {
          title: string
          index: number
          imageinfo?: {
            url: string
            thumburl?: string
            thumbwidth?: number
            thumbheight?: number
            descriptionurl: string
            mime: string
            extmetadata?: Record<string, { value: string }>
          }[]
        }
      >
    }
  }>(url, undefined, signal)
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => a.index - b.index)
  return pages
    .flatMap((p): ImageResult[] => {
      const info = p.imageinfo?.[0]
      if (!info || !/^image\/(png|jpeg|svg\+xml|gif|webp)$/.test(info.mime)) return []
      const meta = info.extmetadata ?? {}
      return [{
        title: stripHtml(meta.ObjectName?.value) || p.title.replace(/^File:/, "").replace(/\.\w+$/, ""),
        url: info.url,
        thumb: info.thumburl ?? info.url,
        page: info.descriptionurl,
        license: stripHtml(meta.LicenseShortName?.value),
        author: stripHtml(meta.Artist?.value)?.slice(0, 80),
        width: info.thumbwidth,
        height: info.thumbheight,
      }]
    })
    .slice(0, count)
}

// --------------------------------------------------------------- maths

let mathPromise: Promise<import("mathjs").MathJsInstance> | null = null

async function getMath() {
  mathPromise ??= import("mathjs").then(({ create, all }) => {
    const math = create(all)
    const blocked = () => {
      throw new Error("Function disabled")
    }
    // Recommended hardening: no importing or redefining functions from expressions.
    math.import({ import: blocked, createUnit: blocked, reviver: blocked }, { override: true })
    return math
  })
  return mathPromise
}

export async function calculate(input: {
  operation: "evaluate" | "simplify" | "derivative" | "solve"
  expression: string
  variable?: string
  range?: { min: number; max: number }
}) {
  const math = await getMath()
  const v = input.variable ?? "x"
  switch (input.operation) {
    case "evaluate": {
      const r = math.evaluate(input.expression)
      return { result: math.format(r, { precision: 12 }) }
    }
    case "simplify":
      return { result: math.simplify(input.expression).toString() }
    case "derivative":
      return { result: math.simplify(math.derivative(input.expression, v)).toString() }
    case "solve": {
      // Numeric roots of lhs = rhs on a range: sign changes + bisection.
      const [lhs, rhs = "0"] = input.expression.split("=")
      const f = math.compile(`(${lhs}) - (${rhs})`)
      const g = (x: number) => Number(f.evaluate({ [v]: x }))
      const lo = input.range?.min ?? -100
      const hi = input.range?.max ?? 100
      const N = 4000
      const roots: number[] = []
      let px = lo
      let py = g(px)
      for (let i = 1; i <= N; i++) {
        const x = lo + ((hi - lo) * i) / N
        const y = g(x)
        if (Number.isFinite(py) && Number.isFinite(y)) {
          if (y === 0) roots.push(x)
          else if (py * y < 0) {
            let a = px
            let b = x
            for (let k = 0; k < 80; k++) {
              const m = (a + b) / 2
              if (g(a) * g(m) <= 0) b = m
              else a = m
            }
            const root = (a + b) / 2
            // Skip poles: a real root makes |g| small.
            if (Math.abs(g(root)) < 1e-6 * Math.max(1, Math.abs(py), Math.abs(y))) roots.push(root)
          }
        }
        px = x
        py = y
      }
      const rounded = [...new Set(roots.map((r) => Math.round(r * 1e9) / 1e9))]
      return {
        result: rounded.length ? rounded.map((r) => `${v} ≈ ${r}`).join(", ") : `No real roots found for ${v} in [${lo}, ${hi}].`,
        roots: rounded,
      }
    }
  }
}

// ---------------------------------------------------------------- tools

export function createServerTools(ctx: { snapshot: string | null; images: string[] }) {
  return {
    // Web tools ported from the pi agent setup (see ./web).
    web_search: webSearchTool,
    web_fetch: webFetchTool,
    research: createResearchTool(),

    find_images: tool({
      description:
        "Find real, openly licensed images (photos, diagrams, maps, artworks, historical figures) on Wikimedia Commons. They are shown in the chat with attribution; the student can pin one onto the whiteboard.",
      inputSchema: z.object({
        query: z.string(),
        count: z.number().int().min(1).max(8).optional(),
      }),
      execute: async ({ query, count }, { abortSignal }) => ({
        query,
        images: await findImages(query, count ?? 4, abortSignal),
      }),
    }),

    calculate: tool({
      description:
        "Exact maths with a computer algebra engine (math.js): evaluate numbers and units ('9.81 m/s^2 * 3 s to km/h'), simplify, differentiate, or find numeric roots of an equation. Use it instead of doing arithmetic in your head.",
      inputSchema: z.object({
        operation: z.enum(["evaluate", "simplify", "derivative", "solve"]),
        expression: z.string().describe("math.js syntax. For solve: an equation like 'x^3 - 2x = 1'."),
        variable: z.string().optional(),
        range: z.object({ min: z.number(), max: z.number() }).optional().describe("solve: search interval."),
      }),
      execute: async (input) => {
        try {
          return { expression: input.expression, operation: input.operation, ...(await calculate(input)) }
        } catch (e) {
          return { expression: input.expression, operation: input.operation, error: (e as Error).message }
        }
      },
    }),

    look_closer: tool({
      description:
        "Ask the vision model a specific question about the latest picture of the whiteboard, or about an image the student attached (image: 1 = their first attached image). E.g. 'What did the student write in the your-turn frame?', 'What does the graph in their photo show at x = 2?'.",
      inputSchema: z.object({
        question: z.string(),
        image: z.number().int().min(1).optional().describe("Attached image number; omit for the whiteboard."),
      }),
      execute: async ({ question, image }, { abortSignal }) => {
        const url = image ? ctx.images[image - 1] : ctx.snapshot
        if (!url) return { answer: image ? `There is no attached image #${image}.` : "No board picture is available for this turn." }
        const { text } = await generateText({
          model: getModel("vision"),
          abortSignal,
          messages: [
            {
              role: "user",
              content: [
                { type: "file", data: new URL(url), mediaType: url.slice(5, url.indexOf(";")) || "image/jpeg" },
                {
                  type: "text",
                  text: `${image ? "This is an image the student shared with their tutor." : "This is a shared whiteboard between a tutor and a student."} ${question}\nAnswer precisely and briefly; transcribe handwriting exactly.`,
                },
              ],
            },
          ],
        })
        return { answer: text }
      },
    }),

    show_3d: tool({
      description:
        "Show an interactive 3D scene in the lesson (student can orbit, zoom, expand it): molecules, atoms, solar system, vectors, solids, surfaces z=f(x,y), parametric curves, geography, mechanics. Objects can spin or orbit. y is up.",
      inputSchema: show3dInput,
      execute: async ({ title }) => ({ shown: true, title }),
    }),

    chart: tool({
      description:
        "Show a data chart (bar, stacked-bar, line, area, scatter) in the lesson for real datasets: statistics, history, economics, science measurements. Use researched numbers and set `source`.",
      inputSchema: chartInput,
      execute: async ({ title }) => ({ shown: true, title }),
    }),

    explore: tool({
      description:
        "Show an interactive explorer: a live graph of y = f(x, params) with sliders for each parameter, so the student can discover how parameters change the curve (amplitude, frequency, growth rate, supply/demand shifts...).",
      inputSchema: exploreInput,
      execute: async ({ title }) => ({ shown: true, title }),
    }),

    suggest_replies: tool({
      description:
        "Offer 2-4 short follow-ups the student can click (next questions or answers to your question). Call once, as the very last thing in a reply.",
      inputSchema: suggestRepliesInput,
      execute: async () => ({ shown: true }),
    }),
  }
}

export type ServerTools = ReturnType<typeof createServerTools>
