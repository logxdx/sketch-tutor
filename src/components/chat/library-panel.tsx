"use client"

import { ChevronRightIcon, FileUpIcon, FolderIcon, FolderUpIcon, LibraryBigIcon, PaperclipIcon, Trash2Icon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { formatBytes } from "@/lib/context/client"
import type { LibraryDocMeta } from "@/lib/context/types"
import type { LibraryApi } from "@/lib/context/use-library"
import { docIcon } from "./message"

type FileNode =
  | { type: "file"; name: string; path: string; doc: LibraryDocMeta }
  | { type: "folder"; name: string; path: string; children: FileNode[] }

/** Build a folder tree from document paths (folders first, then files, alphabetical). */
function buildTree(docs: LibraryDocMeta[]): FileNode[] {
  const root: FileNode[] = []
  for (const doc of docs) {
    const segments = doc.path.split("/").filter(Boolean)
    let level = root
    let prefix = ""
    segments.slice(0, -1).forEach((seg) => {
      prefix = prefix ? `${prefix}/${seg}` : seg
      let folder = level.find((n): n is Extract<FileNode, { type: "folder" }> => n.type === "folder" && n.name === seg)
      if (!folder) {
        folder = { type: "folder", name: seg, path: prefix, children: [] }
        level.push(folder)
      }
      level = folder.children
    })
    level.push({ type: "file", name: segments.at(-1) ?? doc.name, path: doc.path, doc })
  }
  const sort = (nodes: FileNode[]): FileNode[] =>
    nodes
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1))
      .map((n) => (n.type === "folder" ? { ...n, children: sort(n.children) } : n))
  return sort(root)
}

const countFiles = (node: FileNode): number =>
  node.type === "file" ? 1 : node.children.reduce((s, c) => s + countFiles(c), 0)

/** shadcn File Tree pattern, with attach / remove actions per file. */
function FileTreeNode({ node, library }: { node: FileNode; library: LibraryApi }) {
  if (node.type === "folder") {
    return (
      <Collapsible defaultOpen>
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start font-normal aria-expanded:bg-transparent aria-expanded:hover:bg-muted dark:aria-expanded:hover:bg-muted/50"
            />
          }
        >
          <ChevronRightIcon className="transition-transform group-data-panel-open/button:rotate-90" />
          <FolderIcon />
          <span className="truncate">{node.name}</span>
          <span className="ml-auto text-xs text-muted-foreground">{countFiles(node)}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-4 flex flex-col">
            {node.children.map((child) => (
              <FileTreeNode key={child.path} node={child} library={library} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    )
  }
  const { doc } = node
  const attached = library.drafts.some((d) => d.kind === "doc" && d.doc?.id === doc.id)
  return (
    <div className="group/file flex items-center">
      <Button
        variant="ghost"
        size="sm"
        className={`min-w-0 flex-1 justify-start font-normal ${attached ? "bg-accent text-accent-foreground" : ""}`}
        title={`Attach ${doc.path} to your next message`}
        onClick={() => library.attachExisting(doc)}
      >
        {docIcon(doc.kind)}
        <span className="truncate">{node.name}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {doc.pages ? `${doc.pages}p` : formatBytes(doc.size)}
        </span>
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100"
        aria-label={`Remove ${doc.path} from library`}
        onClick={() => library.remove([doc.id])}
      >
        <Trash2Icon />
      </Button>
    </div>
  )
}

export function LibraryPanel({
  library,
  onPickFiles,
  onPickFolder,
}: {
  library: LibraryApi
  onPickFiles: () => void
  onPickFolder: () => void
}) {
  const tree = React.useMemo(() => buildTree(library.docs), [library.docs])
  const pages = library.docs.reduce((s, d) => s + (d.pages ?? 0), 0)

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
            <LibraryBigIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-medium">Your library</h3>
            <p className="text-xs text-pretty text-muted-foreground">
              Textbooks, notes, slides and code Sketch can search and cite. Click a file to attach it to your next
              question.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onPickFiles}>
            <FileUpIcon /> Add files
          </Button>
          <Button size="sm" variant="outline" onClick={onPickFolder}>
            <FolderUpIcon /> Add folder
          </Button>
          {library.docs.length ? (
            <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" onClick={() => library.remove("all")}>
              <Trash2Icon /> Clear
            </Button>
          ) : null}
        </div>
        {library.docs.length ? (
          <p className="text-xs text-muted-foreground">
            {library.docs.length} file{library.docs.length > 1 ? "s" : ""}
            {pages ? ` · ${pages} PDF pages` : ""}
          </p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 text-sm">
        {tree.length ? (
          tree.map((node) => <FileTreeNode key={node.path} node={node} library={library} />)
        ) : (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
            <PaperclipIcon className="size-5" />
            Drop PDFs, notes or a whole course folder anywhere in this panel.
          </div>
        )}
      </div>
    </div>
  )
}
