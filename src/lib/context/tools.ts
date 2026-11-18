import "server-only"

import { tool } from "ai"
import { z } from "zod"

import { findDocument, fullText, listDocuments, readDocument, searchLibrary } from "./store"
import type { MessageAttachment } from "./types"

export type LibraryHit = {
  n: number
  docId: string
  name: string
  path: string
  page?: number
  line?: number
  snippet: string
}

/** Tools over the student's own material (PDFs, notes, code, whole folders). */
export function createLibraryTools(libraryId: string | null) {
  return {
    library_search: tool({
      description:
        "Search the student's own material (their uploaded PDFs, notes, textbooks, code and folders) by keywords. Returns numbered snippets with file and page/line — cite them like [L1], [L2]. Use it whenever the question could be answered from their material, before going to the web.",
      inputSchema: z.object({
        query: z.string().describe("Keywords to look for (names, terms, formulas, function names)."),
        files: z
          .array(z.string())
          .optional()
          .describe("Limit to these files (names or paths)."),
        k: z.number().int().min(1).max(12).optional(),
      }),
      execute: async ({ query, files, k }) => {
        if (!libraryId) return { query, hits: [] as LibraryHit[], note: "The student has no library." }
        let docIds: string[] | undefined
        if (files?.length) {
          const found = await Promise.all(files.map((f) => findDocument(libraryId, f)))
          docIds = found.filter((d): d is NonNullable<typeof d> => !!d).map((d) => d.id)
        }
        const hits = await searchLibrary(libraryId, query, k ?? 6, docIds)
        return {
          query,
          hits: hits.map(
            (h, i): LibraryHit => ({
              n: i + 1,
              docId: h.doc.id,
              name: h.doc.name,
              path: h.doc.path,
              page: h.page,
              line: h.line,
              snippet: h.text.replace(/\s+/g, " ").trim().slice(0, 700),
            })
          ),
        }
      },
    }),

    library_read: tool({
      description:
        "Read part of one of the student's documents: pages of a PDF (fromPage/toPage, max ~5 at a time) or a line range of a text/code file (fromLine/toLine). Use after library_search, or when the student points at a file.",
      inputSchema: z.object({
        file: z.string().describe("File name, path or id."),
        fromPage: z.number().int().optional(),
        toPage: z.number().int().optional(),
        fromLine: z.number().int().optional(),
        toLine: z.number().int().optional(),
      }),
      execute: async ({ file, ...range }) => {
        if (!libraryId) throw new Error("The student has no library.")
        const doc = await findDocument(libraryId, file)
        if (!doc) throw new Error(`No file matching "${file}" in the library.`)
        const out = await readDocument(libraryId, doc.id, range)
        return { file: doc.path, docId: doc.id, span: out!.span, text: out!.text }
      },
    }),
  }
}

const fmtSize = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)

/**
 * The library section of the system prompt: what the student has uploaded,
 * plus the full text of small documents attached to their latest message.
 */
export async function librarySection(libraryId: string | null, attached: MessageAttachment[]) {
  if (!libraryId) return ""
  const docs = await listDocuments(libraryId)
  if (!docs.length) return ""
  const recent = [...docs].sort((a, b) => b.addedAt - a.addedAt)
  const shown = recent.slice(0, 80)
  const lines = shown.map(
    (d) => `- ${d.path} (${d.kind}${d.pages ? `, ${d.pages} pages` : ""}, ${fmtSize(d.size)})`
  )
  const parts = [
    `STUDENT'S LIBRARY (${docs.length} file${docs.length > 1 ? "s" : ""}${docs.length > shown.length ? `, newest ${shown.length} listed` : ""}) — search it with library_search, read with library_read, cite as [L1]:`,
    ...lines,
  ]

  const attachedDocs = attached.filter((a): a is Extract<MessageAttachment, { type: "doc" }> => a.type === "doc")
  const folders = attached.filter((a) => a.type === "folder")
  if (attachedDocs.length || folders.length) {
    parts.push("", "JUST ATTACHED by the student with their latest message — this is what they're asking about:")
    let budget = 24000
    for (const a of attachedDocs) {
      const text = await fullText(libraryId, a.docId)
      if (text && text.length <= budget) {
        budget -= text.length
        parts.push(`\n<<< ${a.name} (full text) >>>\n${text}\n<<< end of ${a.name} >>>`)
      } else {
        parts.push(`- ${a.name}${a.pages ? ` (${a.pages} pages)` : ""} — too long to include; use library_search / library_read.`)
      }
    }
    for (const f of folders) {
      if (f.type === "folder") parts.push(`- folder "${f.name}" (${f.files} files) — use library_search to explore it.`)
    }
  }
  return parts.join("\n")
}
