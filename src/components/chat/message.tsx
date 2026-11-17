"use client"

import { BrainIcon, ChevronDownIcon, EyeIcon, ImageIcon } from "lucide-react"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import * as React from "react"
import { Streamdown } from "streamdown"
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@ui-sdk/react/collapsible"

import type { TutorUIMessage } from "@/lib/agent/types"
import { cn } from "@/lib/utils"
import { ToolPartView } from "./tool-cards"

const plugins = { math, mermaid }

function Reasoning({ text, streaming }: { text: string; streaming: boolean }) {
  if (!text.trim()) return null
  return (
    <Collapsible>
      <CollapsibleTrigger className="group inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <BrainIcon className={cn("size-3.5", streaming && "animate-pulse")} aria-hidden />
        {streaming ? "Thinking…" : "Thought it through"}
        <ChevronDownIcon className="size-3 transition-transform group-data-open:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsiblePanel className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0">
        <div className="mt-1.5 border-l-2 pl-3 text-xs whitespace-pre-wrap text-muted-foreground">{text}</div>
      </CollapsiblePanel>
    </Collapsible>
  )
}

export function MessageView({
  message,
  isLast,
  streaming,
}: {
  message: TutorUIMessage
  isLast: boolean
  streaming: boolean
}) {
  if (message.role === "user") {
    const text = message.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n")
    const snapshot = message.parts.find((p) => p.type === "file")
    const kind = message.metadata?.kind
    if (kind === "watch") {
      return (
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <EyeIcon className="size-3" aria-hidden /> Sketch glanced at your drawing
        </div>
      )
    }
    const shown = text.replace(/^\[(check|watching)\]\s*/i, "")
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
          {shown}
        </div>
        {snapshot && snapshot.type === "file" ? (
          <a
            href={snapshot.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            title="The board as Sketch saw it"
          >
            <ImageIcon className="size-3" aria-hidden /> board snapshot shared
          </a>
        ) : null}
      </div>
    )
  }

  const parts = message.parts
  // Last suggest_replies part only, rendered at the very end.
  const lastSuggest = parts.findLastIndex((p) => p.type === "tool-suggest_replies")

  return (
    <div className="flex gap-2.5">
      <div
        aria-hidden
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-tutor font-[cursive] text-sm font-bold text-white shadow-sm"
      >
        S
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {parts.map((part, i) => {
          if (part.type === "text") {
            if (!part.text.trim()) return null
            return (
              <Streamdown
                key={i}
                plugins={plugins}
                className="prose-chat text-sm leading-relaxed"
                isAnimating={streaming && isLast && i === parts.length - 1}
              >
                {part.text}
              </Streamdown>
            )
          }
          if (part.type === "reasoning") {
            return <Reasoning key={i} text={part.text} streaming={streaming && isLast && part.state === "streaming"} />
          }
          if (part.type.startsWith("tool-")) {
            if (part.type === "tool-suggest_replies" && i !== lastSuggest) return null
            return (
              <ToolPartView
                key={i}
                part={part as Parameters<typeof ToolPartView>[0]["part"]}
                isLast={isLast && !streaming}
              />
            )
          }
          return null
        })}
      </div>
    </div>
  )
}
