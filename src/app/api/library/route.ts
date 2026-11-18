import { extractFile, SkipError } from "@/lib/context/extract"
import { addDocument, isValidLibraryId, listDocuments, removeDocuments } from "@/lib/context/store"
import type { UploadResult } from "@/lib/context/types"

export const maxDuration = 120

const bad = (message: string, status = 400) => Response.json({ error: message }, { status })

/** List the documents in a library. */
export async function GET(req: Request) {
  const libraryId = new URL(req.url).searchParams.get("libraryId")
  if (!isValidLibraryId(libraryId)) return bad("Invalid library id")
  return Response.json({ docs: await listDocuments(libraryId) })
}

/**
 * Add files (multipart): `libraryId`, then any number of `file` entries, each
 * optionally paired with a `path` entry (relative path inside a folder).
 */
export async function POST(req: Request) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return bad("Expected multipart form data")
  }
  const libraryId = form.get("libraryId")
  if (!isValidLibraryId(libraryId)) return bad("Invalid library id")
  const files = form.getAll("file").filter((f): f is File => f instanceof File)
  const paths = form.getAll("path").map(String)
  if (!files.length) return bad("No files")

  const result: UploadResult = { docs: [], skipped: [] }
  for (const [i, file] of files.entries()) {
    const path = (paths[i] || file.name).replace(/^\/+/, "").slice(0, 512)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const extracted = await extractFile(file.name, file.type, bytes)
      // PDFs keep their original bytes so the tutor can look at pages later.
      result.docs.push(await addDocument(libraryId, { name: file.name, path, size: file.size }, extracted, bytes))
    } catch (e) {
      const reason = e instanceof SkipError ? e.message : `could not read (${(e as Error).message.slice(0, 120)})`
      result.skipped.push({ path, reason })
    }
  }
  return Response.json(result)
}

/** Remove documents: `?libraryId=…&docId=…` (repeatable) or `&all=1`. */
export async function DELETE(req: Request) {
  const params = new URL(req.url).searchParams
  const libraryId = params.get("libraryId")
  if (!isValidLibraryId(libraryId)) return bad("Invalid library id")
  await removeDocuments(libraryId, params.get("all") === "1" ? "all" : params.getAll("docId"))
  return Response.json({ docs: await listDocuments(libraryId) })
}
