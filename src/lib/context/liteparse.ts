import "server-only"

import { LiteParse } from "@llamaindex/liteparse"

/**
 * PDF parsing and page rendering with LiteParse (Rust core + PDFium, Node
 * bindings). Text comes back per page as Markdown reconstructed from the
 * layout (headings, lists, tables); scanned pages are OCR'd locally
 * (Tesseract), so no cloud calls. PDFium is not thread-safe, so LiteParse
 * serialises parses inside the process.
 */

let parser: LiteParse | null = null
let renderer: LiteParse | null = null

function getParser() {
  parser ??= new LiteParse({
    outputFormat: "markdown",
    imageMode: "placeholder",
    ocrEnabled: process.env.LITEPARSE_OCR !== "false",
    ocrLanguage: process.env.LITEPARSE_OCR_LANG || "eng",
    maxPages: 1500,
    continueOnPageError: true,
    quiet: true,
  })
  return parser
}

/** Separate instance for screenshots: a DPI that's legible for vision models without huge images. */
function getRenderer() {
  renderer ??= new LiteParse({ dpi: Number(process.env.LITEPARSE_PAGE_DPI) || 110, ocrEnabled: false, quiet: true })
  return renderer
}

export type ParsedPdf = {
  pages: { page: number; label?: string; markdown: string }[]
  totalPages: number
  pageErrors: number
}

export async function parsePdf(bytes: Uint8Array): Promise<ParsedPdf> {
  const result = await getParser().parse(Buffer.from(bytes))
  return {
    totalPages: result.totalPages,
    pageErrors: result.pageErrors.length,
    pages: result.pages.map((p) => ({
      page: p.pageNum,
      label: p.pageLabel,
      // Markdown when layout reconstruction produced any, otherwise plain text.
      markdown: (p.markdown?.trim() ? p.markdown : p.text).replace(/\n{3,}/g, "\n\n").trim(),
    })),
  }
}

/** Render one page of a PDF (path or bytes) to PNG. */
export async function renderPage(input: string | Uint8Array, page: number) {
  const [shot] = await getRenderer().screenshot(typeof input === "string" ? input : Buffer.from(input), [page])
  if (!shot) throw new Error(`Page ${page} could not be rendered`)
  return { png: shot.imageBuffer, width: shot.width, height: shot.height, blank: shot.isSolidFill }
}
