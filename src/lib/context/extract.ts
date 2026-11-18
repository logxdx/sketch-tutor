import "server-only"

import { DOC_EXTENSIONS, extOf, LIMITS, type DocKind } from "./types"

export type Extracted = {
  kind: DocKind
  /** One entry per page (PDF) or a single entry (text). */
  pages: string[]
  title?: string
}

const CODE = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "r", "jl", "m", "java", "kt", "c", "h", "cpp", "hpp", "cs", "go", "rs",
  "rb", "php", "swift", "sql", "sh", "bash", "zsh", "lua", "dart", "scala", "hs", "ex", "exs", "vue", "svelte", "css", "scss", "html", "htm",
])
const DATA = new Set(["csv", "tsv", "json", "yaml", "yml", "toml", "xml"])

export class SkipError extends Error {}

async function extractPdf(bytes: Uint8Array): Promise<Extracted> {
  const { getDocumentProxy } = await import("unpdf")
  const pdf = await getDocumentProxy(bytes)
  const meta = await pdf.getMetadata().catch(() => null)
  const info = meta?.info && typeof meta.info === "object" ? (meta.info as Record<string, unknown>) : null
  const pages: string[] = []
  const max = Math.min(pdf.numPages, 800)
  for (let i = 1; i <= max; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    // Keep line breaks where the PDF has them, so tables and equations stay readable.
    let text = ""
    for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
      text += (item.str ?? "") + (item.hasEOL ? "\n" : " ")
    }
    pages.push(text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim())
  }
  if (!pages.some((p) => p.length > 20)) {
    throw new SkipError("no extractable text (scanned PDF?) — attach the pages as images instead")
  }
  return { kind: "pdf", pages, title: typeof info?.Title === "string" ? info.Title.trim() || undefined : undefined }
}

function extractNotebook(raw: string): string {
  try {
    const nb = JSON.parse(raw) as { cells?: { cell_type: string; source: string | string[] }[] }
    return (nb.cells ?? [])
      .map((c) => {
        const src = Array.isArray(c.source) ? c.source.join("") : c.source
        return c.cell_type === "code" ? "```python\n" + src + "\n```" : src
      })
      .join("\n\n")
  } catch {
    return raw
  }
}

/** Turn an uploaded file into text pages, or throw SkipError with a reason. */
export async function extractFile(name: string, type: string, bytes: Uint8Array): Promise<Extracted> {
  const ext = extOf(name)
  const isPdf = ext === "pdf" || type === "application/pdf"
  if (isPdf) {
    if (bytes.byteLength > LIMITS.maxPdfBytes) throw new SkipError("PDF larger than 25 MB")
    return extractPdf(bytes)
  }
  if (!DOC_EXTENSIONS.includes(ext) && !type.startsWith("text/")) {
    throw new SkipError(`unsupported file type${ext ? ` .${ext}` : ""}`)
  }
  if (bytes.byteLength > LIMITS.maxTextBytes) throw new SkipError("text file larger than 4 MB")
  // Binary sniff: NUL bytes in the first 8 KB.
  if (bytes.subarray(0, 8192).includes(0)) throw new SkipError("binary file")
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes)
  if (ext === "ipynb") return { kind: "notebook", pages: [extractNotebook(raw)] }
  const kind: DocKind = CODE.has(ext) ? "code" : DATA.has(ext) ? "data" : "text"
  if (!raw.trim()) throw new SkipError("empty file")
  return { kind, pages: [raw] }
}
