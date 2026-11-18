"use client"

import { ArrowUpRightIcon, BookOpenIcon, GlobeIcon } from "lucide-react"

import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace"
import type { TutorUIMessage } from "@/lib/agent/types"

type Source = { key: string; title: string; href?: string; detail: string; library: boolean }

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** Every source a reply drew on: web results, research briefs, the student's own files. */
export function collectSources(message: TutorUIMessage): Source[] {
  const seen = new Map<string, Source>()
  for (const part of message.parts) {
    if (!part.type.startsWith("tool-") || !("state" in part) || part.state !== "output-available") continue
    const out = part.output as Record<string, unknown>
    if (part.type === "tool-web_search" || part.type === "tool-research") {
      const list = ((out.results ?? out.sources) as { url: string; title?: string }[] | undefined) ?? []
      for (const s of list) {
        if (!s.url || seen.has(s.url)) continue
        seen.set(s.url, { key: s.url, title: s.title || host(s.url), href: s.url, detail: host(s.url), library: false })
      }
    }
    if (part.type === "tool-library_search") {
      for (const h of (out.hits as { path: string; page?: number; line?: number }[] | undefined) ?? []) {
        const key = `${h.path}#${h.page ?? h.line ?? ""}`
        if (seen.has(key)) continue
        seen.set(key, {
          key,
          title: h.path,
          detail: h.page ? `page ${h.page}` : h.line ? `line ${h.line}` : "your file",
          library: true,
        })
      }
    }
  }
  return [...seen.values()]
}

/** shadcn Sources pattern: a collapsible "Used N sources" line listing each source. */
export function SourcesFooter({ message }: { message: TutorUIMessage }) {
  const sources = collectSources(message)
  if (!sources.length) return null
  const fromLibrary = sources.filter((s) => s.library).length
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>{fromLibrary === sources.length ? <BookOpenIcon /> : <GlobeIcon />}</TraceIcon>
            <TraceTitle>
              Used {sources.length} source{sources.length > 1 ? "s" : ""}
            </TraceTitle>
            {fromLibrary && fromLibrary < sources.length ? (
              <TraceDescription>{fromLibrary} from your files</TraceDescription>
            ) : null}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Trace>
            {sources.map((s) =>
              s.href ? (
                <a key={s.key} href={s.href} target="_blank" rel="noreferrer">
                  <TraceLine>
                    <TraceTitle>
                      {s.title}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </TraceTitle>
                    <TraceDescription>{s.detail}</TraceDescription>
                    <TraceIcon>
                      <ArrowUpRightIcon />
                    </TraceIcon>
                  </TraceLine>
                </a>
              ) : (
                <div key={s.key}>
                  <TraceLine>
                    <TraceIcon>
                      <BookOpenIcon />
                    </TraceIcon>
                    <TraceTitle>{s.title}</TraceTitle>
                    <TraceDescription>{s.detail}</TraceDescription>
                  </TraceLine>
                </div>
              )
            )}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}
