import "server-only"

import { parsePdf } from "./liteparse"
import { DOC_EXTENSIONS, extOf, LIMITS, type DocKind } from "./types"

export type Extracted = {
  kind: DocKind
  /** One entry per page (PDF, as Markdown) or a single entry (text). */
  pages: string[]
  /** Printed page labels ("iv", "A-1") where the PDF defines them. */
  labels?: (string | undefined)[]
}

const CODE = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "r", "jl", "m", "java", "kt", "c", "h", "cpp", "hpp", "cs", "go", "rs",
  "rb", "php", "swift", "sql", "sh", "bash", "zsh", "lua", "dart", "scala", "hs", "ex", "exs", "vue", "svelte", "css", "scss", "html", "htm",
])
const DATA = new Set(["csv", "tsv", "json", "yaml", "yml", "toml", "xml"])

export class SkipError extends Error {}

/** PDFs go through LiteParse: per-page Markdown from the layout, with local OCR for scanned pages. */
async function extractPdf(bytes: Uint8Array): Promise<Extracted> {
  let parsed
  try {
    parsed = await parsePdf(bytes)
  } catch (e) {
    const msg = (e as Error).message
    throw new SkipError(/password/i.test(msg) ? "password-protected PDF" : `unreadable PDF (${msg.slice(0, 80)})`)
  }
  // Keep one entry per page (empty pages included) so page numbers stay aligned.
  const pages: string[] = []
  for (const p of parsed.pages) pages[p.page - 1] = p.markdown
  for (let i = 0; i < parsed.totalPages; i++) pages[i] ??= ""
  if (!pages.some((p) => p.length > 10)) {
    // Still useful: the tutor can look at the pages with library_view_page.
    pages[0] = "(No text could be extracted, even with OCR — use library_view_page to look at the pages.)"
  }
  return { kind: "pdf", pages, labels: parsed.pages.map((p) => p.label) }
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
