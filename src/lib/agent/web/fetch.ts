import "server-only"

import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"
import TurndownService from "turndown"

import { resolveKey } from "./keys"

/**
 * Fetch a URL and extract readable content as markdown.
 * Ported from the pi agent's web-fetch extension (~/.pi/agent/extensions/web-fetch):
 * TinyFish Fetch API → local Readability + Turndown (with PDF and Next.js RSC
 * support) → Jina Reader. Added for a server context: an SSRF guard that
 * refuses private / loopback addresses.
 */

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
const DEFAULT_TIMEOUT_MS = 30000
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024
const MAX_PDF_SIZE = 20 * 1024 * 1024
const MIN_USEFUL_CONTENT = 500
const JINA_READER_BASE = "https://r.jina.ai/"
const JINA_TIMEOUT_MS = 30000
const TINYFISH_FETCH_URL = "https://api.fetch.tinyfish.ai"
const TINYFISH_PER_URL_TIMEOUT_MS = 45000
const TINYFISH_TIMEOUT_MS = 50000

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" })

export interface FetchResult {
  url: string
  title: string
  content: string
  error: string | null
  via?: "tinyfish" | "http" | "jina"
}

// ── SSRF guard ───────────────────────────────────────────────────────

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number)
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
  }
  const v6 = ip.toLowerCase()
  return (
    v6 === "::1" ||
    v6 === "::" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe80") ||
    (v6.startsWith("::ffff:") && isPrivateAddress(v6.slice(7)))
  )
}

async function assertPublicUrl(raw: string) {
  const url = new URL(raw)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) URLs can be fetched")
  if (process.env.WEB_FETCH_ALLOW_PRIVATE === "true") return
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Refusing to fetch a local address")
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new Error("Refusing to fetch a private address")
}

// ── TinyFish Fetch (first tier) ──────────────────────────────────────

/** Free TinyFish Fetch API: renders JS-heavy pages and PDFs into markdown. null → fall back. */
async function extractWithTinyFish(url: string, signal?: AbortSignal): Promise<FetchResult | null> {
  const key = await resolveKey("TINYFISH_API_KEY")
  if (!key) return null
  try {
    const res = await fetch(TINYFISH_FETCH_URL, {
      method: "POST",
      headers: { "X-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ urls: [url], format: "markdown", per_url_timeout_ms: TINYFISH_PER_URL_TIMEOUT_MS }),
      signal: AbortSignal.any([AbortSignal.timeout(TINYFISH_TIMEOUT_MS), ...(signal ? [signal] : [])]),
    })
    // 402 = daily allowance used, 429 = rate limited: fall back
    if (!res.ok) return null
    const data = (await res.json()) as {
      results?: Array<{ final_url?: string; title?: string | null; text?: unknown }>
      errors?: Array<{ error?: string; status?: number }>
    }
    const failure = data.errors?.[0]
    if (failure?.error === "page_not_found") {
      return { url, title: "", content: "", error: `Page not found (HTTP ${failure.status ?? 404})`, via: "tinyfish" }
    }
    const page = data.results?.[0]
    const text = typeof page?.text === "string" ? page.text.trim() : ""
    if (!text) return null
    return {
      url: page?.final_url || url,
      title: page?.title?.trim() || extractHeadingTitle(text) || url,
      content: text,
      error: null,
      via: "tinyfish",
    }
  } catch {
    return null
  }
}

// ── PDF ──────────────────────────────────────────────────────────────

function isPDF(url: string, contentType?: string): boolean {
  if (contentType?.includes("application/pdf")) return true
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf")
  } catch {
    return false
  }
}

async function extractPDF(buffer: ArrayBuffer, url: string): Promise<FetchResult> {
  const { getDocumentProxy } = await import("unpdf")
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const metadata = await pdf.getMetadata()
  const info = metadata.info && typeof metadata.info === "object" ? (metadata.info as Record<string, unknown>) : null
  const metaTitle = typeof info?.Title === "string" ? info.Title.trim() : ""
  const metaAuthor = typeof info?.Author === "string" ? info.Author.trim() : ""
  let urlTitle = "document"
  try {
    urlTitle = (new URL(url).pathname.split("/").pop() ?? "").replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim() || "document"
  } catch {}
  const title = metaTitle || urlTitle

  const maxPages = Math.min(pdf.numPages, 100)
  const pages: string[] = []
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .map((item: unknown) => (item as { str?: string }).str || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
    if (pageText) pages.push(pageText)
  }
  const lines = [
    `# ${title}`,
    "",
    `> Source: ${url}`,
    `> Pages: ${pdf.numPages}${pdf.numPages > maxPages ? ` (extracted first ${maxPages})` : ""}`,
  ]
  if (metaAuthor) lines.push(`> Author: ${metaAuthor}`)
  lines.push("", "---", "", pages.join("\n\n"))
  if (pdf.numPages > maxPages) {
    lines.push("", "---", "", `*[Truncated: Only first ${maxPages} of ${pdf.numPages} pages extracted]*`)
  }
  return { url, title, content: lines.join("\n"), error: null }
}

// ── RSC content extraction (Next.js pages) ───────────────────────────

function extractRSCContent(html: string): { title: string; content: string } | null {
  if (!html.includes("self.__next_f.push")) return null
  const chunkMap = new Map<string, string>()
  const scriptRegex = /<script>self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/g
  for (const match of html.matchAll(scriptRegex)) {
    let content: string
    try {
      content = JSON.parse('"' + match[1] + '"')
    } catch {
      continue
    }
    for (const line of content.split("\n")) {
      if (!line.trim()) continue
      const colonIdx = line.indexOf(":")
      if (colonIdx <= 0 || colonIdx > 4) continue
      const id = line.slice(0, colonIdx)
      if (!/^[0-9a-f]+$/i.test(id)) continue
      const payload = line.slice(colonIdx + 1)
      if (!payload) continue
      const existing = chunkMap.get(id)
      if (!existing || payload.length > existing.length) chunkMap.set(id, payload)
    }
  }
  if (chunkMap.size === 0) return null

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/)
  const title = titleMatch?.[1]?.split("|")[0]?.trim() || ""

  const parsedCache = new Map<string, unknown>()
  function getParsedChunk(id: string): unknown | null {
    if (parsedCache.has(id)) return parsedCache.get(id)
    const chunk = chunkMap.get(id)
    if (!chunk || !chunk.startsWith("[")) {
      parsedCache.set(id, null)
      return null
    }
    try {
      const parsed = JSON.parse(chunk)
      parsedCache.set(id, parsed)
      return parsed
    } catch {
      parsedCache.set(id, null)
      return null
    }
  }

  const visitedRefs = new Set<string>()
  function extractNode(node: unknown, ctx = { inCode: false }): string {
    if (node === null || node === undefined) return ""
    if (typeof node === "string") {
      const refMatch = node.match(/^\$L([0-9a-f]+)$/i)
      if (refMatch) {
        const refId = refMatch[1]
        if (visitedRefs.has(refId)) return ""
        visitedRefs.add(refId)
        const refNode = getParsedChunk(refId)
        const result = refNode ? extractNode(refNode, ctx) : ""
        visitedRefs.delete(refId)
        return result
      }
      if (!ctx.inCode && (node === "$undefined" || node === "$" || /^\$[A-Z]/.test(node))) return ""
      return node.trim() ? node : ""
    }
    if (typeof node === "number") return String(node)
    if (typeof node === "boolean") return ""
    if (!Array.isArray(node)) return ""

    if (node[0] === "$" && typeof node[1] === "string") {
      const tag = node[1] as string
      const props = (node[3] || {}) as Record<string, unknown>
      const skipTags = ["script", "style", "svg", "path", "circle", "link", "meta", "template", "button", "input", "nav", "footer", "aside"]
      if (skipTags.includes(tag)) return ""
      if (tag.startsWith("$L")) {
        const refId = tag.slice(2)
        if (visitedRefs.has(refId)) return ""
        if (props.baseId && props.children) return `## ${String(props.children)}\n\n`
        visitedRefs.add(refId)
        const refNode = getParsedChunk(refId)
        let result = ""
        if (refNode) result = extractNode(refNode, ctx)
        else if (props.children) result = extractNode(props.children, ctx)
        visitedRefs.delete(refId)
        return result
      }
      const children = props.children
      const content = children ? extractNode(children, ctx) : ""
      switch (tag) {
        case "h1": return `# ${content.trim()}\n\n`
        case "h2": return `## ${content.trim()}\n\n`
        case "h3": return `### ${content.trim()}\n\n`
        case "h4": return `#### ${content.trim()}\n\n`
        case "h5": return `##### ${content.trim()}\n\n`
        case "h6": return `###### ${content.trim()}\n\n`
        case "p": return `${content.trim()}\n\n`
        case "code": {
          const cc = children ? extractNode(children, { inCode: true }) : ""
          return ctx.inCode ? cc : `\`${cc}\``
        }
        case "pre": {
          const pc = children ? extractNode(children, { inCode: true }) : ""
          return "```\n" + pc + "\n```\n\n"
        }
        case "strong": case "b": return `**${content}**`
        case "em": case "i": return `*${content}*`
        case "li": return `- ${content.trim()}\n`
        case "ul": case "ol": return content + "\n"
        case "blockquote": return `> ${content.trim()}\n\n`
        case "a": {
          const href = props.href as string | undefined
          return href && !href.startsWith("#") ? `[${content}](${href})` : content
        }
        default: return content
      }
    }
    return (node as unknown[]).map((n) => extractNode(n, ctx)).join("")
  }

  const mainChunk = getParsedChunk("23")
  if (mainChunk) {
    const content = extractNode(mainChunk)
    if (content.trim().length > 100) return { title, content: content.replace(/\n{3,}/g, "\n\n").trim() }
  }

  const contentParts: { order: number; text: string }[] = []
  for (const [id] of chunkMap) {
    if (id === "23") continue
    const parsed = getParsedChunk(id)
    if (!parsed) continue
    visitedRefs.clear()
    const text = extractNode(parsed)
    if (text.trim().length > 50 && !text.includes("page was not found") && !text.includes("404")) {
      contentParts.push({ order: parseInt(id, 16), text: text.trim() })
    }
  }
  if (contentParts.length === 0) return null
  contentParts.sort((a, b) => a.order - b.order)
  const seen = new Set<string>()
  const uniqueParts: string[] = []
  for (const part of contentParts) {
    const key = part.text.slice(0, 150)
    if (!seen.has(key)) {
      seen.add(key)
      uniqueParts.push(part.text)
    }
  }
  const content = uniqueParts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim()
  return content.length > 100 ? { title, content } : null
}

// ── Helpers ──────────────────────────────────────────────────────────

function isLikelyJSRendered(html: string): boolean {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  if (!bodyMatch) return false
  const textContent = bodyMatch[1]
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
  const scriptCount = (html.match(/<script/gi) || []).length
  return textContent.length < 500 && scriptCount > 3
}

function extractHeadingTitle(text: string): string | null {
  const match = text.match(/^#{1,2}\s+(.+)/m)
  if (!match) return null
  return match[1].replace(/\*+/g, "").trim() || null
}

// ── Jina Reader fallback ─────────────────────────────────────────────

async function extractWithJinaReader(url: string, signal?: AbortSignal): Promise<FetchResult | null> {
  try {
    const res = await fetch(JINA_READER_BASE + url, {
      headers: { Accept: "text/markdown", "X-No-Cache": "true" },
      signal: AbortSignal.any([AbortSignal.timeout(JINA_TIMEOUT_MS), ...(signal ? [signal] : [])]),
    })
    if (!res.ok) return null
    const content = await res.text()
    const contentStart = content.indexOf("Markdown Content:")
    if (contentStart < 0) return null
    const markdownPart = content.slice(contentStart + 17).trim()
    if (markdownPart.length < 100 || markdownPart.startsWith("Loading...") || markdownPart.startsWith("Please enable JavaScript")) {
      return null
    }
    const title = extractHeadingTitle(markdownPart) ?? new URL(url).pathname.split("/").pop() ?? url
    return { url, title, content: markdownPart, error: null }
  } catch {
    return null
  }
}

// ── Local HTTP extraction ────────────────────────────────────────────

async function extractViaHttp(url: string, signal?: AbortSignal): Promise<FetchResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  signal?.addEventListener("abort", onAbort)

  try {
    await assertPublicUrl(url)
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
    })
    // A redirect could land on a private host: check the final URL too.
    if (response.url && response.url !== url) await assertPublicUrl(response.url)

    if (!response.ok) return { url, title: "", content: "", error: `HTTP ${response.status}: ${response.statusText}` }

    const contentType = response.headers.get("content-type") || ""
    const contentLengthHeader = response.headers.get("content-length")
    const isPDFContent = isPDF(url, contentType)
    const maxSize = isPDFContent ? MAX_PDF_SIZE : MAX_RESPONSE_SIZE
    if (contentLengthHeader) {
      const contentLength = parseInt(contentLengthHeader, 10)
      if (contentLength > maxSize) {
        return { url, title: "", content: "", error: `Response too large (${Math.round(contentLength / 1024 / 1024)}MB)` }
      }
    }
    if (isPDFContent) return await extractPDF(await response.arrayBuffer(), url)
    if (/application\/octet-stream|image\/|audio\/|video\/|application\/zip/.test(contentType)) {
      return { url, title: "", content: "", error: `Unsupported content type: ${contentType.split(";")[0]}` }
    }

    const text = await response.text()
    const isHTML = contentType.includes("text/html") || contentType.includes("application/xhtml+xml")
    if (!isHTML) {
      const title = extractHeadingTitle(text) ?? new URL(url).pathname.split("/").pop() ?? url
      return { url, title, content: text, error: null }
    }

    const { document } = parseHTML(text)
    const article = new Readability(document as unknown as Document).parse()
    if (!article) {
      const rsc = extractRSCContent(text)
      if (rsc) return { url, title: rsc.title, content: rsc.content, error: null }
      return {
        url,
        title: "",
        content: "",
        error: isLikelyJSRendered(text)
          ? "Page appears to be JavaScript-rendered (content loads dynamically)"
          : "Could not extract readable content from HTML structure",
      }
    }
    const markdown = turndown.turndown(article.content ?? "")
    if (markdown.length < MIN_USEFUL_CONTENT) {
      return {
        url,
        title: article.title || "",
        content: markdown,
        error: isLikelyJSRendered(text)
          ? "Page appears to be JavaScript-rendered (content loads dynamically)"
          : "Extracted content appears incomplete",
      }
    }
    return { url, title: article.title || "", content: markdown, error: null }
  } catch (err) {
    return { url, title: "", content: "", error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener("abort", onAbort)
  }
}

// ── Public ───────────────────────────────────────────────────────────

export async function fetchAndExtract(url: string, signal?: AbortSignal): Promise<FetchResult> {
  if (signal?.aborted) return { url, title: "", content: "", error: "Aborted" }
  try {
    await assertPublicUrl(url)
  } catch (e) {
    return { url, title: "", content: "", error: (e as Error).message }
  }

  const tinyfishResult = await extractWithTinyFish(url, signal)
  if (tinyfishResult) return tinyfishResult
  if (signal?.aborted) return { url, title: "", content: "", error: "Aborted" }

  const httpResult = await extractViaHttp(url, signal)
  if (signal?.aborted) return { url, title: "", content: "", error: "Aborted" }
  if (!httpResult.error) return { ...httpResult, via: "http" }
  if (
    httpResult.error.startsWith("Unsupported content type") ||
    httpResult.error.startsWith("Response too large") ||
    httpResult.error.startsWith("Refusing")
  ) {
    return httpResult
  }

  const jinaResult = await extractWithJinaReader(url, signal)
  if (jinaResult) return { ...jinaResult, via: "jina" }
  if (signal?.aborted) return { url, title: "", content: "", error: "Aborted" }

  return {
    ...httpResult,
    error: `${httpResult.error}\n\nThe page may be JavaScript-rendered. Try a different URL for the same content, or web_search for alternatives.`,
  }
}
