/** Shared (client + server) types for the student's context library. */

export type DocKind = "pdf" | "text" | "code" | "data" | "notebook"

export type LibraryDocMeta = {
  id: string
  name: string
  /** Relative path inside an uploaded folder, or just the file name. */
  path: string
  kind: DocKind
  size: number
  chars: number
  pages?: number
  addedAt: number
}

/** What a user message carries about files attached to it (rendered as Attachment cards). */
export type MessageAttachment =
  | { type: "doc"; docId: string; name: string; kind: DocKind; pages?: number; size: number }
  | { type: "folder"; name: string; files: number; skipped: number }

export type UploadResult = {
  docs: LibraryDocMeta[]
  skipped: { path: string; reason: string }[]
}

/** Extensions the library ingests (everything else in a folder is skipped). */
export const TEXT_EXTENSIONS = [
  "txt", "md", "mdx", "markdown", "rst", "tex", "csv", "tsv", "json", "yaml", "yml", "toml", "xml", "html", "htm",
  "css", "scss", "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "ipynb", "r", "jl", "m", "java", "kt", "c", "h", "cpp",
  "hpp", "cs", "go", "rs", "rb", "php", "swift", "sql", "sh", "bash", "zsh", "lua", "dart", "scala", "hs", "ex", "exs",
  "vue", "svelte", "srt", "vtt", "log", "ini", "cfg", "env.example", "bib",
]
export const DOC_EXTENSIONS = ["pdf", ...TEXT_EXTENSIONS]
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"]

/** Folder names never worth ingesting. */
export const SKIP_DIRS = ["node_modules", ".git", ".next", "dist", "build", "out", ".venv", "venv", "__pycache__", ".cache", ".idea", ".vscode", "target", "coverage"]

export const LIMITS = {
  maxPdfBytes: 25 * 1024 * 1024,
  maxTextBytes: 4 * 1024 * 1024,
  maxDocsPerLibrary: 3000,
  maxFolderFiles: 1500,
}

export function extOf(name: string) {
  const lower = name.toLowerCase()
  if (lower.endsWith(".env.example")) return "env.example"
  const i = lower.lastIndexOf(".")
  return i >= 0 ? lower.slice(i + 1) : ""
}
