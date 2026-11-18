"use client"

import {
  BookOpenTextIcon,
  ListTreeIcon,
  PinIcon,
  ScanEyeIcon,
  BrainIcon,
  CalculatorIcon,
  CircleDotIcon,
  EraserIcon,
  EyeIcon,

  GlobeIcon,
  HandIcon,
  LibraryBigIcon,
  LineChartIcon,
  MousePointer2Icon,
  PenLineIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react"
import * as React from "react"

import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockActions,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block"
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
import { markdownPlugins } from "@/lib/markdown"
import { Streamdown } from "streamdown"
import { toast } from "@ui-sdk/react/toast"

import { Button } from "@/components/ui/button"
import type { TutorUIMessage } from "@/lib/agent/types"
import { useTutor } from "./tutor-context"

type Part = TutorUIMessage["parts"][number]
export type ToolPart = Extract<Part, { type: `tool-${string}` }>
export type ReasoningPart = Extract<Part, { type: "reasoning" }>

/** Tools rendered as Trace lines (process), as opposed to rich cards (media). */
export const STEP_TOOLS = new Set([
  "draw",
  "plot",
  "annotate",
  "point_at",
  "erase",
  "ask_student",
  "web_search",
  "web_fetch",
  "research",
  "calculate",
  "look_closer",
  "library_search",
  "library_read",
  "library_outline",
  "library_view_page",
])

/** Tools the browser executes (still running while the board animates, after the stream ends). */
const CLIENT_TOOLS = new Set(["draw", "plot", "annotate", "point_at", "erase", "ask_student"])

/**
 * AI SDK tool state → Trace line status (shadcn Tool pattern): running while
 * the chat streams, "error" if it stopped before the step finished.
 */
function statusOf(part: ToolPart, live: boolean): "running" | "error" | "pending" | undefined {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return live || CLIENT_TOOLS.has(part.type.slice(5)) ? "running" : "error"
    case "output-error":
    case "output-denied":
      return "error"
    case "approval-requested":
      return "pending"
    default:
      return undefined
  }
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

type Input = Record<string, unknown> | undefined

const STEP: Record<
  string,
  { icon: React.ReactNode; running: (i: Input) => string; done: (i: Input, o: unknown) => string }
> = {
  draw: { icon: <PenLineIcon />, running: (i) => `Drawing ${i?.title ?? ""}`, done: (i) => `Drew ${i?.title ?? "on the board"}` },
  plot: {
    icon: <LineChartIcon />,
    running: () => "Graphing on the board",
    done: (i) => `Graphed ${i?.title ?? (i?.functions as { expr: string }[] | undefined)?.map((f) => f.expr).join(", ") ?? ""}`,
  },
  annotate: {
    icon: <CircleDotIcon />,
    running: () => "Marking up the board",
    done: (i) => (i?.note ? `Marked: ${i.note}` : `Marked your work`),
  },
  point_at: {
    icon: <MousePointer2Icon />,
    running: () => "Pointing",
    done: (i) => (i?.caption ? `Pointed: ${i.caption}` : "Pointed at the board"),
  },
  erase: { icon: <EraserIcon />, running: () => "Erasing", done: () => "Erased some drawings" },
  ask_student: { icon: <HandIcon />, running: () => "Handing you the pen", done: (i) => `Your turn: ${i?.task ?? ""}` },
  web_search: {
    icon: <SearchIcon />,
    running: (i) => `Searching the web for ${i?.query ?? "…"}`,
    done: (i) => `Searched ${i?.query ?? "the web"}`,
  },
  web_fetch: {
    icon: <GlobeIcon />,
    running: (i) => `Reading ${host(String(i?.url ?? ""))}`,
    done: (i, o) => `Read ${(o as { title?: string })?.title || host(String(i?.url ?? ""))}`,
  },
  research: {
    icon: <SparklesIcon />,
    running: (i) => `Researching ${i?.question ?? ""}`,
    done: (i) => `Researched ${i?.question ?? ""}`,
  },
  calculate: {
    icon: <CalculatorIcon />,
    running: (i) => `Calculating ${i?.expression ?? ""}`,
    done: (i, o) => `${i?.expression ?? ""} = ${(o as { result?: string })?.result ?? (o as { error?: string })?.error ?? "?"}`,
  },
  look_closer: {
    icon: <EyeIcon />,
    running: () => "Looking closely",
    done: (i) => `Looked closely: ${i?.question ?? ""}`,
  },
  library_search: {
    icon: <LibraryBigIcon />,
    running: (i) => `Searching your files for ${i?.query ?? "…"}`,
    done: (i) => `Searched your files for ${i?.query ?? ""}`,
  },
  library_read: {
    icon: <BookOpenTextIcon />,
    running: (i) => `Reading ${i?.file ?? "your file"}`,
    done: (i, o) => `Read ${(o as { file?: string })?.file ?? i?.file ?? ""} ${(o as { span?: string })?.span ? `(${(o as { span: string }).span})` : ""}`,
  },
  library_outline: {
    icon: <ListTreeIcon />,
    running: (i) => `Skimming ${i?.file ?? "your file"}`,
    done: (i, o) => `Skimmed ${(o as { file?: string })?.file ?? i?.file ?? ""} (${(o as { pages?: number })?.pages ?? "?"} pages)`,
  },
  library_view_page: {
    icon: <ScanEyeIcon />,
    running: (i) => `Looking at page ${i?.page ?? "?"} of ${i?.file ?? "your file"}`,
    done: (i, o) => `Looked at page ${i?.page ?? "?"} of ${(o as { file?: string })?.file ?? i?.file ?? ""}`,
  },
}

/** The page screenshot the tutor looked at, with what it saw and a way to put it on the board. */
function PageView({ out }: { out: { file: string; page: number; pages: number; question: string; answer: string; imageUrl: string } }) {
  const { board } = useTutor()
  return (
    <div className="space-y-2">
      <a href={out.imageUrl} target="_blank" rel="noreferrer" className="block w-fit">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={out.imageUrl}
          alt={`Page ${out.page} of ${out.file}`}
          className="max-h-80 rounded-md border bg-white shadow-xs"
          loading="lazy"
        />
      </a>
      <p className="text-xs">
        <span className="font-medium text-foreground">Asked:</span> {out.question}
      </p>
      <Streamdown plugins={{ math: markdownPlugins.math }} className="prose-chat text-sm">
        {out.answer}
      </Streamdown>
      <Button
        size="xs"
        variant="outline"
        onClick={() =>
          board
            ?.addImage({ url: out.imageUrl, title: `${out.file} — page ${out.page}` })
            .catch((e: Error) => toast.error("Couldn't pin the page", { description: e.message }))
        }
      >
        <PinIcon /> Pin page to board
      </Button>
    </div>
  )
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2)
  return (
    <CodeBlock size="sm" className="bg-muted/60">
      <CodeBlockHeader>
        <CodeBlockTitle>{title}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={text} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent wrap className="max-h-64">
        {text}
      </CodeBlockContent>
    </CodeBlock>
  )
}

type Hit = { n: number; title?: string; name?: string; url?: string; path?: string; page?: number; line?: number; snippet?: string; date?: string }

function HitList({ hits, library }: { hits: Hit[]; library?: boolean }) {
  return (
    <ol className="space-y-2">
      {hits.map((h) => (
        <li key={`${h.n}-${h.url ?? h.path}`} className="flex gap-2 text-sm">
          <span className="mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-secondary px-1 font-mono text-[10px] text-secondary-foreground">
            {library ? `L${h.n}` : h.n}
          </span>
          <span className="min-w-0">
            {h.url ? (
              <a href={h.url} target="_blank" rel="noreferrer" className="font-medium text-foreground hover:underline">
                {h.title || host(h.url)}
              </a>
            ) : (
              <span className="font-medium text-foreground">
                {h.path ?? h.name}
                {h.page ? ` · p. ${h.page}` : h.line ? ` · line ${h.line}` : ""}
              </span>
            )}
            {h.url ? <span className="ml-1.5 text-xs">{host(h.url)}{h.date ? ` · ${h.date}` : ""}</span> : null}
            {h.snippet ? <span className="mt-0.5 line-clamp-2 block text-xs">{h.snippet}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** Details shown when a step is expanded. */
function StepDetails({ name, part }: { name: string; part: ToolPart }) {
  if (part.state === "output-error") return <p className="text-sm text-destructive">{part.errorText}</p>
  if (part.state !== "output-available") return <JsonBlock title="Input" value={part.input} />
  const out = part.output as Record<string, unknown>
  switch (name) {
    case "web_search":
      return <HitList hits={(out.results as Hit[]) ?? []} />
    case "research":
      return (
        <div className="space-y-3">
          <p className="text-sm whitespace-pre-wrap">{String(out.brief ?? "")}</p>
          <HitList hits={(out.sources as Hit[]) ?? []} />
        </div>
      )
    case "library_search":
      return (out.hits as Hit[])?.length ? (
        <HitList hits={out.hits as Hit[]} library />
      ) : (
        <p className="text-sm">No matches in your files.</p>
      )
    case "library_read":
      return <JsonBlock title={`${out.file} · ${out.span}`} value={out.text} />
    case "library_view_page":
      return <PageView out={out as Parameters<typeof PageView>[0]["out"]} />
    case "library_outline":
      return (
        <ol className="max-h-64 space-y-0.5 overflow-y-auto text-xs">
          {((out.outline as { page: number; summary: string }[]) ?? []).map((e) => (
            <li key={e.page} className="flex gap-2">
              <span className="w-8 shrink-0 text-right font-mono tabular-nums">p{e.page}</span>
              <span className="min-w-0 truncate">{e.summary || "—"}</span>
            </li>
          ))}
        </ol>
      )
    case "web_fetch":
      return <JsonBlock title={String(out.title || out.url)} value={String(out.content ?? "").slice(0, 4000)} />
    case "look_closer":
      return <p className="text-sm whitespace-pre-wrap">{String(out.answer ?? "")}</p>
    default:
      return <JsonBlock title="Result" value={out} />
  }
}

export function StepLine({ part, live }: { part: ToolPart; live: boolean }) {
  const { board } = useTutor()
  const name = part.type.slice(5)
  const meta = STEP[name]
  if (!meta) return null
  const status = statusOf(part, live)
  const input = part.input as Input
  const done = part.state === "output-available"
  const title = done ? meta.done(input, part.output) : status === "error" ? `Failed: ${meta.running(input)}` : `${meta.running(input)}…`
  const onBoard = ["draw", "plot", "annotate", "ask_student"].includes(name)

  const line = (
    <TraceLine status={status}>
      <TraceIcon>{meta.icon}</TraceIcon>
      <TraceTitle>{title}</TraceTitle>
      {name === "web_search" && done ? (
        <TraceDescription>{((part.output as { results?: unknown[] })?.results ?? []).length} results</TraceDescription>
      ) : null}
      {name === "library_search" && done ? (
        <TraceDescription>{((part.output as { hits?: unknown[] })?.hits ?? []).length} matches</TraceDescription>
      ) : null}
    </TraceLine>
  )

  // Board steps: clicking jumps the board to what was drawn.
  if (onBoard) {
    return done ? (
      <button type="button" onClick={() => board?.focusStep(part.toolCallId)} title="Show on the board">
        {line}
      </button>
    ) : (
      <div>{line}</div>
    )
  }
  if (name === "point_at" || name === "erase") return <div>{line}</div>
  // A plain line while it runs; a collapsible once there is output to show.
  if (!done && status !== "error") return <div>{line}</div>

  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <StepDetails name={name} part={part} />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

/**
 * All the reasoning in one run of steps as a single line — one "Thought it
 * through" per run instead of one between every tool call.
 */
export function ReasoningLine({ text, streaming }: { text: string; streaming: boolean }) {
  // Open while it streams; the reader's click wins (shadcn Reasoning pattern).
  const [open, setOpen] = React.useState<boolean>()
  if (!text.trim() && !streaming) return null
  return (
    <TraceCollapsible open={open ?? streaming} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine status={streaming ? "running" : undefined}>
          <TraceIcon>
            <BrainIcon />
          </TraceIcon>
          <TraceTitle>{streaming ? "Thinking" : "Thought it through"}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="text-sm whitespace-pre-wrap">{text}</TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

/** A run of consecutive agent steps rendered as one Trace. */
export function StepTrace({ children }: { children: React.ReactNode }) {
  return <Trace className="py-0.5">{children}</Trace>
}


