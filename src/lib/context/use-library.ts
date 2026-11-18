"use client"

import * as React from "react"

import {
  filterFolder,
  getLibraryId,
  imageToDataUrl,
  isDocFile,
  isImageFile,
  listLibrary,
  removeFromLibrary,
  uploadToLibrary,
  type PendingFile,
} from "./client"
import type { LibraryDocMeta, MessageAttachment } from "./types"

/** Something waiting in the composer to be sent with the next message. */
export type DraftAttachment = {
  key: string
  name: string
  state: "uploading" | "processing" | "done" | "error"
  detail?: string
} & (
  | { kind: "image"; url?: string; mediaType?: string }
  | { kind: "doc"; doc?: LibraryDocMeta }
  | { kind: "folder"; files: number; done: number; skipped: number }
)

let seq = 0
const key = () => `a${Date.now().toString(36)}${seq++}`

/** The student's library plus the composer's pending attachments. */
export function useLibrary() {
  // The id is never rendered, so reading localStorage lazily can't cause a hydration mismatch.
  const [libraryId] = React.useState<string | null>(() => (typeof window === "undefined" ? null : getLibraryId()))
  const [docs, setDocs] = React.useState<LibraryDocMeta[]>([])
  const [drafts, setDrafts] = React.useState<DraftAttachment[]>([])

  React.useEffect(() => {
    if (libraryId) listLibrary(libraryId).then(setDocs).catch(() => {})
  }, [libraryId])

  const patch = (k: string, update: Partial<DraftAttachment>) =>
    setDrafts((cur) => cur.map((d) => (d.key === k ? ({ ...d, ...update } as DraftAttachment) : d)))

  const mergeDocs = (added: LibraryDocMeta[]) =>
    setDocs((cur) => [...cur.filter((d) => !added.some((a) => a.path === d.path)), ...added])

  /** Single files (picker, paste, drop): images stay with the message, documents go to the library. */
  const addFiles = React.useCallback(
    async (files: File[]) => {
      if (!libraryId) return
      for (const file of files) {
        if (isImageFile(file)) {
          const k = key()
          setDrafts((cur) => [...cur, { key: k, kind: "image", name: file.name || "image", state: "processing" }])
          imageToDataUrl(file)
            .then(({ url, mediaType }) => patch(k, { state: "done", url, mediaType } as Partial<DraftAttachment>))
            .catch(() => patch(k, { state: "error", detail: "Couldn't read this image" }))
        } else if (isDocFile(file)) {
          const k = key()
          setDrafts((cur) => [...cur, { key: k, kind: "doc", name: file.name, state: "uploading" }])
          uploadToLibrary(libraryId, [{ file, path: file.name }]).then((res) => {
            const doc = res.docs[0]
            if (doc) {
              mergeDocs([doc])
              patch(k, { state: "done", doc } as Partial<DraftAttachment>)
            } else patch(k, { state: "error", detail: res.skipped[0]?.reason ?? "Couldn't read this file" })
          })
        } else {
          setDrafts((cur) => [
            ...cur,
            { key: key(), kind: "doc", name: file.name, state: "error", detail: "Unsupported file type" },
          ])
        }
      }
    },
    [libraryId]
  )

  /** A whole folder: readable files go to the library, the message carries a folder card. */
  const addFolder = React.useCallback(
    async (name: string, files: PendingFile[]) => {
      if (!libraryId) return
      const { keep, skipped } = filterFolder(files)
      const k = key()
      setDrafts((cur) => [
        ...cur,
        { key: k, kind: "folder", name, files: keep.length, done: 0, skipped, state: keep.length ? "uploading" : "error", detail: keep.length ? undefined : "No readable files" },
      ])
      if (!keep.length) return
      let added = 0
      let failed = 0
      await uploadToLibrary(libraryId, keep, (done, _total, part) => {
        added += part.docs.length
        failed += part.skipped.length
        mergeDocs(part.docs)
        patch(k, { done } as Partial<DraftAttachment>)
      })
      patch(k, {
        state: added ? "done" : "error",
        files: added,
        skipped: skipped + failed,
        detail: added ? undefined : "Nothing could be read",
      } as Partial<DraftAttachment>)
    },
    [libraryId]
  )

  const removeDraft = (k: string) => setDrafts((cur) => cur.filter((d) => d.key !== k))

  /** Attach a document that's already in the library to the next message. */
  const attachExisting = (doc: LibraryDocMeta) =>
    setDrafts((cur) =>
      cur.some((d) => d.kind === "doc" && d.doc?.id === doc.id)
        ? cur
        : [...cur, { key: key(), kind: "doc", name: doc.name, state: "done", doc }]
    )

  /** Take the drafts for sending: image parts + library attachment metadata. */
  const takeDrafts = () => {
    const ready = drafts.filter((d) => d.state === "done")
    const files = ready.flatMap((d) =>
      d.kind === "image" && d.url ? [{ type: "file" as const, mediaType: d.mediaType ?? "image/jpeg", url: d.url, filename: d.name }] : []
    )
    const attachments: MessageAttachment[] = ready.flatMap((d): MessageAttachment[] => {
      if (d.kind === "doc" && d.doc) return [{ type: "doc", docId: d.doc.id, name: d.doc.name, kind: d.doc.kind, pages: d.doc.pages, size: d.doc.size }]
      if (d.kind === "folder") return [{ type: "folder", name: d.name, files: d.files, skipped: d.skipped }]
      return []
    })
    setDrafts([])
    return { files, attachments }
  }

  const remove = React.useCallback(
    async (docIds: string[] | "all") => {
      if (!libraryId) return
      setDocs(await removeFromLibrary(libraryId, docIds))
    },
    [libraryId]
  )

  const busy = drafts.some((d) => d.state === "uploading" || d.state === "processing")

  return { libraryId, docs, drafts, busy, addFiles, addFolder, removeDraft, attachExisting, takeDrafts, remove }
}

export type LibraryApi = ReturnType<typeof useLibrary>
