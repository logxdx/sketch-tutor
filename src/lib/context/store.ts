import "server-only"

import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { Extracted } from "./extract"
import { LIMITS, type LibraryDocMeta } from "./types"

/**
 * The student's context library: documents split into chunks with a BM25
 * keyword index. One library per browser (id generated client-side), kept
 * in memory and persisted as JSON under .data/library so it survives restarts.
 */

export type Chunk = {
  docId: string
  /** 1-based page for PDFs. */
  page?: number
  /** 1-based first line for text files. */
  line?: number
  text: string
}

type Library = { docs: LibraryDocMeta[]; chunks: Chunk[]; version: 1 }

const DATA_DIR = join(process.cwd(), ".data", "library")
const libraries = new Map<string, Library>()
const loading = new Map<string, Promise<Library>>()
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const isValidLibraryId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(id)

export async function getLibrary(id: string): Promise<Library> {
  const cached = libraries.get(id)
  if (cached) return cached
  let pending = loading.get(id)
  if (!pending) {
    pending = readFile(join(DATA_DIR, `${id}.json`), "utf8")
      .then((raw) => JSON.parse(raw) as Library)
      .catch(() => ({ docs: [], chunks: [], version: 1 as const }))
      .then((lib) => {
        libraries.set(id, lib)
        loading.delete(id)
        return lib
      })
    loading.set(id, pending)
  }
  return pending
}

function scheduleSave(id: string) {
  const prev = saveTimers.get(id)
  if (prev) clearTimeout(prev)
  saveTimers.set(
    id,
    setTimeout(async () => {
      saveTimers.delete(id)
      const lib = libraries.get(id)
      if (!lib) return
      await mkdir(DATA_DIR, { recursive: true })
      const tmp = join(DATA_DIR, `${id}.json.tmp`)
      await writeFile(tmp, JSON.stringify(lib))
      await rename(tmp, join(DATA_DIR, `${id}.json`))
    }, 400)
  )
}

const CHUNK_CHARS = 1400

function chunkDoc(docId: string, ex: Extracted): Chunk[] {
  const chunks: Chunk[] = []
  if (ex.kind === "pdf") {
    ex.pages.forEach((text, i) => {
      for (let start = 0; start < text.length; start += CHUNK_CHARS) {
        chunks.push({ docId, page: i + 1, text: text.slice(start, start + CHUNK_CHARS + 120) })
      }
    })
    return chunks
  }
  // Text: chunk on line boundaries so citations can point at line numbers.
  const lines = ex.pages[0].split("\n")
  let buf: string[] = []
  let size = 0
  let first = 1
  lines.forEach((line, i) => {
    buf.push(line)
    size += line.length + 1
    if (size >= CHUNK_CHARS) {
      chunks.push({ docId, line: first, text: buf.join("\n") })
      // Small overlap keeps context across chunk borders.
      buf = buf.slice(-2)
      size = buf.reduce((s, l) => s + l.length + 1, 0)
      first = i + 2 - buf.length
    }
  })
  if (buf.join("").trim()) chunks.push({ docId, line: first, text: buf.join("\n") })
  return chunks
}

export async function addDocument(
  libraryId: string,
  file: { name: string; path: string; size: number },
  ex: Extracted
): Promise<LibraryDocMeta> {
  const lib = await getLibrary(libraryId)
  // Re-uploading the same path replaces the old version.
  const existing = lib.docs.find((d) => d.path === file.path)
  if (existing) removeFrom(lib, existing.id)
  if (lib.docs.length >= LIMITS.maxDocsPerLibrary) throw new Error("Library is full (3000 documents).")
  const id = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  const chars = ex.pages.reduce((s, p) => s + p.length, 0)
  const meta: LibraryDocMeta = {
    id,
    // The path's last segment is what the student sees in the tree, so use it as the name too.
    name: file.path.split("/").filter(Boolean).at(-1) || file.name,
    path: file.path,
    kind: ex.kind,
    size: file.size,
    chars,
    pages: ex.kind === "pdf" ? ex.pages.length : undefined,
    addedAt: Date.now(),
  }
  lib.docs.push(meta)
  lib.chunks.push(...chunkDoc(id, ex))
  scheduleSave(libraryId)
  return meta
}

function removeFrom(lib: Library, docId: string) {
  lib.docs = lib.docs.filter((d) => d.id !== docId)
  lib.chunks = lib.chunks.filter((c) => c.docId !== docId)
}

export async function removeDocuments(libraryId: string, docIds: string[] | "all") {
  const lib = await getLibrary(libraryId)
  if (docIds === "all") {
    lib.docs = []
    lib.chunks = []
  } else {
    for (const id of docIds) removeFrom(lib, id)
  }
  scheduleSave(libraryId)
}

// ------------------------------------------------------------------ search

const STOP = new Set(
  "a an the and or of to in on at for by with from is are was were be been it its this that these those as not no do does did what which who how why when where can could should would will i you we they he she them his her their our your about into than then so if".split(
    " "
  )
)

const tokenize = (s: string) =>
  (s.toLowerCase().normalize("NFKD").match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1 && !STOP.has(t))

export type SearchHit = Chunk & { doc: LibraryDocMeta; score: number }

/** BM25 over chunks (k1 = 1.4, b = 0.75), optionally limited to some documents. */
export async function searchLibrary(libraryId: string, query: string, k = 6, docIds?: string[]): Promise<SearchHit[]> {
  const lib = await getLibrary(libraryId)
  const terms = [...new Set(tokenize(query))]
  if (!terms.length) return []
  const chunks = docIds?.length ? lib.chunks.filter((c) => docIds.includes(c.docId)) : lib.chunks
  if (!chunks.length) return []
  const tokenized = chunks.map((c) => tokenize(c.text))
  const avg = tokenized.reduce((s, t) => s + t.length, 0) / tokenized.length || 1
  const df = new Map<string, number>()
  for (const toks of tokenized) for (const t of new Set(toks)) if (terms.includes(t)) df.set(t, (df.get(t) ?? 0) + 1)
  const N = chunks.length
  const byDoc = new Map(lib.docs.map((d) => [d.id, d]))
  const scored: SearchHit[] = []
  tokenized.forEach((toks, i) => {
    let score = 0
    const tf = new Map<string, number>()
    for (const t of toks) if (df.has(t)) tf.set(t, (tf.get(t) ?? 0) + 1)
    for (const [t, f] of tf) {
      const n = df.get(t)!
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      score += idf * ((f * 2.4) / (f + 1.4 * (1 - 0.75 + (0.75 * toks.length) / avg)))
    }
    // Small boost when the file name/path matches the query.
    const doc = byDoc.get(chunks[i].docId)!
    const pathToks = tokenize(doc.path)
    score += terms.filter((t) => pathToks.includes(t)).length * 0.8
    if (score > 0) scored.push({ ...chunks[i], doc, score })
  })
  return scored.sort((a, b) => b.score - a.score).slice(0, k)
}

/** Find a document by id, exact path, or (case-insensitive) file name / path suffix. */
export async function findDocument(libraryId: string, ref: string) {
  const lib = await getLibrary(libraryId)
  const r = ref.trim().toLowerCase()
  return (
    lib.docs.find((d) => d.id === ref) ??
    lib.docs.find((d) => d.path.toLowerCase() === r) ??
    lib.docs.find((d) => d.name.toLowerCase() === r) ??
    lib.docs.find((d) => d.path.toLowerCase().endsWith(r))
  )
}

/** Text of a document (pages for PDFs, line range for text), capped for the model. */
export async function readDocument(
  libraryId: string,
  docId: string,
  range: { fromPage?: number; toPage?: number; fromLine?: number; toLine?: number },
  maxChars = 14000
) {
  const lib = await getLibrary(libraryId)
  const doc = lib.docs.find((d) => d.id === docId)
  if (!doc) return null
  const chunks = lib.chunks.filter((c) => c.docId === docId)
  let text: string
  let span: string
  if (doc.kind === "pdf") {
    const from = Math.max(1, range.fromPage ?? 1)
    const to = Math.min(doc.pages ?? from, range.toPage ?? from + 4)
    const pages = new Map<number, string>()
    for (const c of chunks) if (c.page! >= from && c.page! <= to) pages.set(c.page!, (pages.get(c.page!) ?? "") + c.text.slice(0, CHUNK_CHARS))
    text = [...pages].map(([p, t]) => `--- page ${p} ---\n${t}`).join("\n\n")
    span = `pages ${from}-${to} of ${doc.pages}`
  } else {
    const all = rebuildText(chunks)
    const lines = all.split("\n")
    const from = Math.max(1, range.fromLine ?? 1)
    const to = Math.min(lines.length, range.toLine ?? from + 399)
    text = lines
      .slice(from - 1, to)
      .map((l, i) => `${String(from + i).padStart(4)}  ${l}`)
      .join("\n")
    span = `lines ${from}-${to} of ${lines.length}`
  }
  const truncated = text.length > maxChars
  return { doc, span, text: truncated ? `${text.slice(0, maxChars)}\n[… truncated — read a smaller range]` : text }
}

/** Reassemble text chunks (they overlap by up to two lines). */
function rebuildText(chunks: Chunk[]) {
  const out: string[] = []
  for (const c of chunks) {
    const lines = c.text.split("\n")
    const start = c.line ?? 1
    lines.forEach((l, i) => {
      out[start - 1 + i] = l
    })
  }
  return out.join("\n")
}

/** Full text of a small document (for inlining just-attached docs into the prompt). */
export async function fullText(libraryId: string, docId: string) {
  const lib = await getLibrary(libraryId)
  const doc = lib.docs.find((d) => d.id === docId)
  if (!doc) return null
  const chunks = lib.chunks.filter((c) => c.docId === docId)
  if (doc.kind === "pdf") {
    const pages = new Map<number, string>()
    for (const c of chunks) pages.set(c.page!, (pages.get(c.page!) ?? "") + c.text.slice(0, CHUNK_CHARS))
    return [...pages].map(([p, t]) => `--- page ${p} ---\n${t}`).join("\n\n")
  }
  return rebuildText(chunks)
}

export async function listDocuments(libraryId: string) {
  return (await getLibrary(libraryId)).docs
}
