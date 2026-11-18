"use client"

import { EyeIcon, FileCodeIcon, FileTextIcon, FolderIcon, ImageIcon, SheetIcon } from "lucide-react"
import { markdownPlugins } from "@/lib/markdown"
import { Streamdown } from "streamdown"

import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message"
import { BOARD_SNAPSHOT_NAME, type TutorUIMessage } from "@/lib/agent/types"
import { formatBytes } from "@/lib/context/client"
import type { DocKind, MessageAttachment } from "@/lib/context/types"
import { SourcesFooter } from "./sources"
import { MEDIA_TOOLS, MediaPartView } from "./tool-cards"
import { ReasoningLine, STEP_TOOLS, StepLine, StepTrace, type ToolPart } from "./trace-steps"

const plugins = markdownPlugins

type Part = TutorUIMessage["parts"][number]

export const docIcon = (kind: DocKind) =>
  kind === "code" ? <FileCodeIcon /> : kind === "data" ? <SheetIcon /> : <FileTextIcon />

/** Attachment cards for what the student sent with a message. */
function SentAttachments({ message }: { message: TutorUIMessage }) {
  const images = message.parts.filter(
    (p): p is Extract<Part, { type: "file" }> => p.type === "file" && p.filename !== BOARD_SNAPSHOT_NAME
  )
  const files = message.metadata?.attachments ?? []
  if (!images.length && !files.length) return null
  return (
    <AttachmentGroup className="justify-end">
      {images.map((img, i) => (
        <Attachment key={`img-${i}`} orientation="vertical" className="w-32">
          <AttachmentTrigger
            render={<a href={img.url} target="_blank" rel="noreferrer" />}
            aria-label={`Open ${img.filename ?? "image"}`}
          />
          <AttachmentMedia variant="image">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt={img.filename ?? "attached image"} />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle className="text-xs">{img.filename ?? "Image"}</AttachmentTitle>
          </AttachmentContent>
        </Attachment>
      ))}
      {files.map((f: MessageAttachment, i) =>
        f.type === "folder" ? (
          <Attachment key={`f-${i}`} size="sm">
            <AttachmentMedia>
              <FolderIcon />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{f.name}</AttachmentTitle>
              <AttachmentDescription>
                {f.files} files{f.skipped ? ` · ${f.skipped} skipped` : ""}
              </AttachmentDescription>
            </AttachmentContent>
          </Attachment>
        ) : (
          <Attachment key={`d-${i}`} size="sm">
            <AttachmentMedia>{docIcon(f.kind)}</AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{f.name}</AttachmentTitle>
              <AttachmentDescription>
                {f.pages ? `${f.pages} pages · ` : ""}
                {formatBytes(f.size)}
              </AttachmentDescription>
            </AttachmentContent>
          </Attachment>
        )
      )}
    </AttachmentGroup>
  )
}

/** Split an assistant message into runs: Trace steps, text, and media cards (shadcn Trace grouping). */
function groupRuns(parts: Part[]) {
  type Run = { kind: "trace" | "text" | "media"; parts: Part[] }
  const runs: Run[] = []
  for (const part of parts) {
    let kind: Run["kind"] | null = null
    if (part.type === "reasoning") kind = "trace"
    else if (part.type === "text") kind = part.text.trim() ? "text" : null
    else if (part.type.startsWith("tool-")) {
      const name = part.type.slice(5)
      kind = STEP_TOOLS.has(name) ? "trace" : MEDIA_TOOLS.has(name) ? "media" : null
    }
    if (!kind) continue
    const last = runs.at(-1)
    if (last && last.kind === kind && kind !== "media") last.parts.push(part)
    else runs.push({ kind, parts: [part] })
  }
  return runs
}

export function MessageView({
  message,
  isLast,
  busy,
}: {
  message: TutorUIMessage
  isLast: boolean
  busy: boolean
}) {
  if (message.role === "user") {
    const text = message.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n")
    const kind = message.metadata?.kind
    if (kind === "watch") {
      return (
        <Marker variant="separator">
          <MarkerIcon>
            <EyeIcon />
          </MarkerIcon>
          <MarkerContent>Sketch glanced at your drawing</MarkerContent>
        </Marker>
      )
    }
    const shown = text.replace(/^\[(check|watching)\]\s*/i, "")
    const snapshot = message.parts.some((p) => p.type === "file" && p.filename === BOARD_SNAPSHOT_NAME)
    return (
      <Message align="end">
        <MessageContent className="items-end gap-1.5">
          <SentAttachments message={message} />
          {shown.trim() && shown !== "(see attachments)" ? (
            <Bubble align="end" variant="muted">
              <BubbleContent className="whitespace-pre-wrap">{shown}</BubbleContent>
            </Bubble>
          ) : null}
          {snapshot ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <ImageIcon className="size-3" aria-hidden /> shared the board
            </span>
          ) : null}
        </MessageContent>
      </Message>
    )
  }

  const live = busy && isLast
  const runs = groupRuns(message.parts)
  const lastPart = message.parts.at(-1)

  return (
    <Message>
      <MessageAvatar className="size-8 self-start bg-tutor font-[cursive] text-sm font-bold text-white">S</MessageAvatar>
      <MessageContent className="min-w-0 gap-3">
        {runs.map((run, r) => {
          if (run.kind === "trace") {
            return (
              <StepTrace key={r}>
                <ReasoningLine
                  text={run.parts
                    .map((p) => (p.type === "reasoning" ? p.text.trim() : ""))
                    .filter(Boolean)
                    .join("\n\n")}
                  streaming={live && lastPart?.type === "reasoning" && run.parts.includes(lastPart)}
                />
                {run.parts.map((p, i) =>
                  p.type === "reasoning" ? null : <StepLine key={i} part={p as ToolPart} live={live} />
                )}
              </StepTrace>
            )
          }
          if (run.kind === "text") {
            return run.parts.map((p, i) =>
              p.type === "text" ? (
                <Streamdown
                  key={`${r}-${i}`}
                  plugins={plugins}
                  className="prose-chat text-sm leading-relaxed"
                  isAnimating={live && p === lastPart}
                >
                  {p.text}
                </Streamdown>
              ) : null
            )
          }
          const p = run.parts[0] as ToolPart
          // Only the newest suggestions are clickable.
          if (p.type === "tool-suggest_replies" && message.parts.findLastIndex((x) => x.type === "tool-suggest_replies") !== message.parts.indexOf(p)) {
            return null
          }
          return <MediaPartView key={r} part={p} isLast={isLast && !busy} />
        })}
        {!live ? <SourcesFooter message={message} /> : null}
      </MessageContent>
    </Message>
  )
}
