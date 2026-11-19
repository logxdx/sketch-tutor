"use client"

import {
  ArrowUpIcon,
  CameraIcon,
  FileUpIcon,
  FolderUpIcon,
  ImageIcon,
  LibraryBigIcon,
  Loader2Icon,
  MicIcon,
  PlusIcon,
  SquareIcon,
  TriangleAlertIcon,
  XIcon,
  FolderIcon,
} from "lucide-react"
import * as React from "react"
import { toast } from "@ui-sdk/react/toast"

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import type { DraftAttachment, LibraryApi } from "@/lib/context/use-library"
import { ModelControls } from "@/components/settings/model-controls"
import { useDictation } from "@/lib/voice/use-dictation"
import { cn } from "@/lib/utils"
import type { SettingsApi } from "@/lib/settings/use-settings"
import type { FilePickersHandle } from "./file-pickers"
import { docIcon } from "./message"

function DraftCard({ draft, onRemove }: { draft: DraftAttachment; onRemove: () => void }) {
  const state = draft.state
  const busy = state === "uploading" || state === "processing"
  const description =
    state === "error"
      ? draft.detail
      : draft.kind === "folder"
        ? busy
          ? `Indexing ${draft.done}/${draft.files} files…`
          : `${draft.files} files${draft.skipped ? ` · ${draft.skipped} skipped` : ""}`
        : draft.kind === "doc"
          ? busy
            ? "Reading…"
            : draft.doc?.pages
              ? `${draft.doc.pages} pages · added to library`
              : "added to library"
          : busy
            ? "Preparing…"
            : "Image"

  if (draft.kind === "image" && draft.url) {
    return (
      <Attachment size="sm" state={state}>
        <AttachmentMedia variant="image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={draft.url} alt={draft.name} />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>{draft.name}</AttachmentTitle>
          <AttachmentDescription>Image · sent with your message</AttachmentDescription>
        </AttachmentContent>
        <AttachmentActions>
          <AttachmentAction aria-label={`Remove ${draft.name}`} onClick={onRemove}>
            <XIcon />
          </AttachmentAction>
        </AttachmentActions>
      </Attachment>
    )
  }

  return (
    <Attachment size="sm" state={state}>
      <AttachmentMedia>
        {busy ? (
          <Loader2Icon className="animate-spin" />
        ) : state === "error" ? (
          <TriangleAlertIcon />
        ) : draft.kind === "folder" ? (
          <FolderIcon />
        ) : draft.kind === "image" ? (
          <ImageIcon />
        ) : (
          docIcon(draft.doc?.kind ?? "text")
        )}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{draft.name}</AttachmentTitle>
        <AttachmentDescription>{description}</AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction aria-label={`Remove ${draft.name}`} onClick={onRemove}>
          <XIcon />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  )
}

/** shadcn Prompt Input pattern + attachments (images, documents, folders). */
export function Composer({
  library,
  busy,
  placeholder,
  onSubmit,
  onStop,
  onOpenLibrary,
  pickers,
  inputRef,
  settings,
  onOpenSettings,
}: {
  library: LibraryApi
  busy: boolean
  placeholder: string
  onSubmit: (text: string) => void
  onStop: () => void
  onOpenLibrary: () => void
  pickers: React.RefObject<FilePickersHandle | null>
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  settings?: SettingsApi
  onOpenSettings?: () => void
}) {
  const [text, setText] = React.useState("")
  const formRef = React.useRef<HTMLFormElement>(null)
  const ready = library.drafts.some((d) => d.state === "done")
  const canSend = !busy && !library.busy && (text.trim().length > 0 || ready)

  // Voice input: what was typed before the mic opened, then the live transcript after it.
  const typed = React.useRef("")
  const join = (spoken: string) => [typed.current.trimEnd(), spoken].filter(Boolean).join(" ")
  const dictation = useDictation({
    onText: (spoken) => setText(join(spoken)),
    onError: (message) => toast.error("Voice input", { description: message }),
  })
  const listening = dictation.state === "listening" || dictation.state === "starting"
  const toggleMic = async () => {
    if (dictation.state === "idle") {
      typed.current = text
      await dictation.start()
      inputRef.current?.focus()
    } else if (listening) {
      const spoken = await dictation.stop()
      setText(join(spoken))
      inputRef.current?.focus()
    }
  }
  const loadingModel = dictation.engine.state === "loading" ? Math.round(dictation.engine.progress * 100) : null

  async function submit(event?: React.FormEvent) {
    event?.preventDefault()
    // Enter while talking: finish the transcript, then send it.
    if (listening) {
      const spoken = await dictation.stop()
      const all = join(spoken).trim()
      if (all && !busy) {
        onSubmit(all)
        setText("")
      } else setText(join(spoken))
      return
    }
    if (!canSend) return
    onSubmit(text.trim())
    setText("")
  }

  return (
    <form ref={formRef} onSubmit={submit}>
      <InputGroup className="rounded-2xl bg-card shadow-xs">
        {library.drafts.length > 0 && (
          <InputGroupAddon align="block-start" className="w-full">
            <AttachmentGroup className="w-full">
              {library.drafts.map((d) => (
                <DraftCard key={d.key} draft={d} onRemove={() => library.removeDraft(d.key)} />
              ))}
            </AttachmentGroup>
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"))
            if (images.length) {
              e.preventDefault()
              library.addFiles(images)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              formRef.current?.requestSubmit()
            }
          }}
          placeholder={
            listening
              ? loadingModel !== null
                ? `Listening — loading the speech model (${loadingModel}%), keep talking…`
                : "Listening… Enter sends, the mic button stops"
              : placeholder
          }
          aria-label="Message Sketch"
          rows={1}
          className="field-sizing-content max-h-40 min-h-11 px-3 pt-3"
        />
        <InputGroupAddon align="block-end">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <InputGroupButton size="icon-sm" variant="outline" className="rounded-full" aria-label="Add context" />
              }
            >
              <PlusIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Add context</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => pickers.current?.files()}>
                  <FileUpIcon /> Images, PDFs or notes
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => pickers.current?.folder()}>
                  <FolderUpIcon /> A whole folder
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => pickers.current?.camera()}>
                  <CameraIcon /> Photo of my work
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onOpenLibrary}>
                <LibraryBigIcon /> Browse my library
                {library.docs.length ? <span className="ml-auto text-xs text-muted-foreground">{library.docs.length}</span> : null}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {settings ? <ModelControls api={settings} onOpenSettings={onOpenSettings ?? (() => {})} /> : null}
          <span className="ml-auto flex items-center gap-1.5">
            {loadingModel !== null ? (
              <span className="text-[11px] text-muted-foreground tabular-nums" title="Downloading the on-device speech model (once)">
                Speech {loadingModel}%
              </span>
            ) : null}
            <InputGroupButton
              size="icon-sm"
              variant={listening ? "default" : "ghost"}
              className={cn("relative rounded-full", listening && "bg-red-600 text-white hover:bg-red-600/90")}
              aria-label={listening ? "Stop listening" : "Talk to Sketch"}
              aria-pressed={listening}
              title={listening ? "Stop listening" : "Talk (speech recognised on your device)"}
              disabled={dictation.state === "finishing"}
              onClick={toggleMic}
            >
              {listening ? (
                // Loudness ring around the mic while listening.
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full ring-red-500/40 transition-[box-shadow]"
                  style={{ boxShadow: `0 0 0 ${2 + dictation.level * 8}px rgb(239 68 68 / 0.25)` }}
                />
              ) : null}
              {dictation.state === "finishing" || dictation.state === "starting" ? <Loader2Icon className="animate-spin" /> : <MicIcon />}
            </InputGroupButton>
          {busy ? (
            <InputGroupButton size="icon-sm" variant="default" className="rounded-full" aria-label="Stop" onClick={onStop}>
              <SquareIcon className="fill-current" />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              type="submit"
              size="icon-sm"
              variant="default"
              className="rounded-full"
              aria-label="Send"
              disabled={!canSend && !listening}
            >
              <ArrowUpIcon />
            </InputGroupButton>
          )}
          </span>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
