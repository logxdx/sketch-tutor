"use client"

import * as React from "react"

import { fromDirectoryInput } from "@/lib/context/client"
import type { LibraryApi } from "@/lib/context/use-library"

export type FilePickersHandle = { files: () => void; folder: () => void; camera: () => void }

const ACCEPT =
  "image/*,application/pdf,.txt,.md,.mdx,.tex,.csv,.json,.py,.js,.ts,.tsx,.ipynb,.html,.css,.java,.c,.cpp,.go,.rs,.rb,.sql,.yaml,.yml"

/** Hidden file / folder / camera inputs shared by the composer and the library panel. */
export function FilePickers({ library, ref }: { library: LibraryApi; ref: React.Ref<FilePickersHandle> }) {
  const filesRef = React.useRef<HTMLInputElement>(null)
  const folderRef = React.useRef<HTMLInputElement>(null)
  const cameraRef = React.useRef<HTMLInputElement>(null)

  React.useImperativeHandle(ref, () => ({
    files: () => filesRef.current?.click(),
    folder: () => folderRef.current?.click(),
    camera: () => cameraRef.current?.click(),
  }))

  // webkitdirectory isn't in React's input props.
  React.useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "")
    folderRef.current?.setAttribute("directory", "")
  }, [])

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) library.addFiles(Array.from(e.target.files))
    e.target.value = ""
  }

  return (
    <>
      <input ref={filesRef} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} onChange={onFiles} />
      <input
        ref={folderRef}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const list = e.target.files
          if (list?.length) {
            const files = fromDirectoryInput(list)
            const first = files[0]?.path ?? ""
            library.addFolder(first.includes("/") ? first.split("/")[0] : `${files.length} files`, files)
          }
          e.target.value = ""
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        onChange={onFiles}
      />
    </>
  )
}
