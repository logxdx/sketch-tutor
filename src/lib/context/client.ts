"use client"

import {
  DOC_EXTENSIONS,
  extOf,
  IMAGE_TYPES,
  LIMITS,
  SKIP_DIRS,
  type LibraryDocMeta,
  type UploadResult,
} from "./types"

/** One library per browser; the id is the only "account". */
export function getLibraryId() {
  try {
    let id = localStorage.getItem("sketch-library-id")
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem("sketch-library-id", id)
    }
    return id
  } catch {
    return null
  }
}

export async function listLibrary(libraryId: string): Promise<LibraryDocMeta[]> {
  const res = await fetch(`/api/library?libraryId=${encodeURIComponent(libraryId)}`)
  if (!res.ok) throw new Error(`Library unavailable (${res.status})`)
  return ((await res.json()) as { docs: LibraryDocMeta[] }).docs
}

export async function removeFromLibrary(libraryId: string, docIds: string[] | "all") {
  const q = new URLSearchParams({ libraryId })
  if (docIds === "all") q.set("all", "1")
  else docIds.forEach((id) => q.append("docId", id))
  const res = await fetch(`/api/library?${q}`, { method: "DELETE" })
  return ((await res.json()) as { docs: LibraryDocMeta[] }).docs
}

export type PendingFile = { file: File; path: string }

/** Upload in small batches so big folders show progress and stay under request limits. */
export async function uploadToLibrary(
  libraryId: string,
  files: PendingFile[],
  onBatch?: (done: number, total: number, partial: UploadResult) => void
): Promise<UploadResult> {
  const total = files.length
  const result: UploadResult = { docs: [], skipped: [] }
  let i = 0
  while (i < files.length) {
    const batch: PendingFile[] = []
    let bytes = 0
    while (i < files.length && batch.length < 12 && (bytes < 8e6 || batch.length === 0)) {
      batch.push(files[i])
      bytes += files[i].file.size
      i++
    }
    const form = new FormData()
    form.set("libraryId", libraryId)
    for (const f of batch) {
      form.append("file", f.file, f.file.name)
      form.append("path", f.path)
    }
    try {
      const res = await fetch("/api/library", { method: "POST", body: form })
      if (!res.ok) throw new Error(`upload failed (${res.status})`)
      const part = (await res.json()) as UploadResult
      result.docs.push(...part.docs)
      result.skipped.push(...part.skipped)
      onBatch?.(i, total, part)
    } catch (e) {
      const skipped = batch.map((f) => ({ path: f.path, reason: (e as Error).message }))
      result.skipped.push(...skipped)
      onBatch?.(i, total, { docs: [], skipped })
    }
  }
  return result
}

// ------------------------------------------------------------- classify

export const isImageFile = (f: File) => IMAGE_TYPES.includes(f.type)
export const isDocFile = (f: File) => f.type === "application/pdf" || DOC_EXTENSIONS.includes(extOf(f.name))

/** Keep folder files the library can read; report the rest. */
export function filterFolder(files: PendingFile[]) {
  const keep: PendingFile[] = []
  let skipped = 0
  for (const f of files) {
    const parts = f.path.split("/")
    const hidden = parts.some((p, i) => i < parts.length - 1 && (SKIP_DIRS.includes(p) || (p.startsWith(".") && p !== ".")))
    const tooBig = f.file.size > (extOf(f.file.name) === "pdf" ? LIMITS.maxPdfBytes : LIMITS.maxTextBytes)
    if (hidden || tooBig || !isDocFile(f.file) || parts.at(-1)!.startsWith(".")) skipped++
    else keep.push(f)
  }
  if (keep.length > LIMITS.maxFolderFiles) {
    skipped += keep.length - LIMITS.maxFolderFiles
    keep.length = LIMITS.maxFolderFiles
  }
  return { keep, skipped }
}

/** Files from an <input webkitdirectory> selection, with their relative paths. */
export function fromDirectoryInput(list: FileList): PendingFile[] {
  return Array.from(list).map((file) => ({ file, path: file.webkitRelativePath || file.name }))
}

/** Walk dropped folders (DataTransfer items) into files with relative paths. */
export async function fromDataTransfer(dt: DataTransfer): Promise<{ files: PendingFile[]; folders: string[] }> {
  const entries = Array.from(dt.items)
    .map((it) => (it.kind === "file" ? it.webkitGetAsEntry?.() : null))
    .filter((e): e is FileSystemEntry => !!e)
  if (!entries.length) return { files: Array.from(dt.files).map((file) => ({ file, path: file.name })), folders: [] }

  const files: PendingFile[] = []
  const folders: string[] = []
  const readAll = (dir: FileSystemDirectoryEntry) =>
    new Promise<FileSystemEntry[]>((resolve) => {
      const reader = dir.createReader()
      const out: FileSystemEntry[] = []
      const next = () =>
        reader.readEntries((batch) => {
          if (!batch.length) resolve(out)
          else {
            out.push(...batch)
            next()
          }
        }, () => resolve(out))
      next()
    })
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (files.length > LIMITS.maxFolderFiles * 2) return
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) => (entry as FileSystemFileEntry).file(resolve, () => resolve(null)))
      if (file) files.push({ file, path: prefix + entry.name })
    } else if (entry.isDirectory && !SKIP_DIRS.includes(entry.name) && !entry.name.startsWith(".")) {
      for (const child of await readAll(entry as FileSystemDirectoryEntry)) await walk(child, `${prefix}${entry.name}/`)
    }
  }
  for (const e of entries) {
    if (e.isDirectory) folders.push(e.name)
    await walk(e, "")
  }
  return { files, folders }
}

// ---------------------------------------------------------------- images

/** Downscale large photos (phone pictures of homework) before sending them to the model. */
export async function imageToDataUrl(file: File, maxSide = 1600): Promise<{ url: string; mediaType: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const keepOriginal = scale === 1 && file.size < 1.5e6
  if (keepOriginal) {
    const url = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = () => reject(r.error)
      r.readAsDataURL(file)
    })
    return { url, mediaType: file.type }
  }
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return { url: canvas.toDataURL("image/jpeg", 0.86), mediaType: "image/jpeg" }
}

export const formatBytes = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`
