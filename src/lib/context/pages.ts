import "server-only"

import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import { renderPage } from "./liteparse"
import { getLibrary, originalPath, pageCachePath } from "./store"

/** PNG of one page of a library PDF, rendered with LiteParse and cached on disk. */
export async function getPageImage(libraryId: string, docId: string, page: number) {
  const lib = await getLibrary(libraryId)
  const doc = lib.docs.find((d) => d.id === docId)
  if (!doc) throw new Error("No such document in the library.")
  if (!doc.viewable) throw new Error(`${doc.path} has no stored original to render.`)
  const pages = doc.pages ?? 1
  if (!Number.isInteger(page) || page < 1 || page > pages) throw new Error(`${doc.path} has pages 1-${pages}.`)

  const cache = pageCachePath(libraryId, docId, page)
  const cached = await readFile(cache).catch(() => null)
  if (cached) return { doc, png: cached }

  const source = originalPath(libraryId, docId)
  await access(source)
  const { png } = await renderPage(source, page)
  await mkdir(dirname(cache), { recursive: true })
  await writeFile(cache, png)
  return { doc, png }
}

/** Same-origin URL the UI (and the board) can load a page image from. */
export const pageImageUrl = (libraryId: string, docId: string, page: number) =>
  `/api/library/page?${new URLSearchParams({ libraryId, docId, page: String(page) })}`
