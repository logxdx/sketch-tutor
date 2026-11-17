"use client"

import {
  BoxIcon,
  CalculatorIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDotIcon,
  EraserIcon,
  EyeIcon,
  FileTextIcon,
  GlobeIcon,
  HandIcon,
  ImageIcon,
  LineChartIcon,
  Loader2Icon,
  MousePointer2Icon,
  PenLineIcon,
  PinIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  XCircleIcon,
  BarChart3Icon,
} from "lucide-react"
import dynamic from "next/dynamic"
import * as React from "react"
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@ui-sdk/react/collapsible"
import { toast } from "@ui-sdk/react/toast"

import { ExpandDialog } from "@/components/ui-sdk/expand-dialog"
import { ChartView } from "@/components/viz/chart-view"
import { Explorer } from "@/components/viz/explorer"
import type { z } from "zod"

import type { chartInput, exploreInput, quizInput, show3dInput } from "@/lib/agent/schemas"
import type { TutorUIMessage } from "@/lib/agent/types"
import { cn } from "@/lib/utils"
import { useTutor } from "./tutor-context"

const Scene3D = dynamic(() => import("@/components/viz/scene-3d"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading 3D…</div>,
})

type Part = TutorUIMessage["parts"][number]
type ToolPart = Extract<Part, { type: `tool-${string}` }>
type PartOf<N extends string> = Extract<Part, { type: `tool-${N}` }>

const running = (p: ToolPart) => p.state === "input-streaming" || p.state === "input-available"

// ------------------------------------------------------------- shells

function Chip({
  icon,
  children,
  state,
  onClick,
  title,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  state: ToolPart["state"]
  onClick?: () => void
  title?: string
}) {
  const busy = state === "input-streaming" || state === "input-available"
  const failed = state === "output-error"
  const Comp = onClick ? "button" : "div"
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0",
        onClick && "transition-colors hover:border-primary/40 hover:text-foreground",
        failed && "border-destructive/30 text-destructive"
      )}
    >
      {busy ? <Loader2Icon className="animate-spin" /> : icon}
      <span className="truncate">{children}</span>
    </Comp>
  )
}

function Card({
  icon,
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  icon: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs", className)}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="text-primary [&_svg]:size-4">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          {subtitle ? <div className="truncate text-xs text-muted-foreground">{subtitle}</div> : null}
        </div>
        {actions}
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function Favicon({ url }: { url: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      src={`https://www.google.com/s2/favicons?domain=${host(url)}&sz=32`}
      className="size-4 shrink-0 rounded-sm"
      loading="lazy"
    />
  )
}

function SourceList({ sources }: { sources: { n: number; title: string; url: string; snippet?: string; date?: string }[] }) {
  return (
    <ol className="space-y-1.5">
      {sources.map((s) => (
        <li key={`${s.n}-${s.url}`}>
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="group flex gap-2 rounded-lg p-1.5 transition-colors hover:bg-muted"
          >
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-secondary font-mono text-[10px] text-secondary-foreground">
              {s.n}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <Favicon url={s.url} />
                <span className="truncate text-sm font-medium group-hover:underline">{s.title || host(s.url)}</span>
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {host(s.url)}
                {s.date ? ` · ${s.date}` : ""}
              </span>
              {s.snippet ? <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{s.snippet}</span> : null}
            </span>
          </a>
        </li>
      ))}
    </ol>
  )
}

// -------------------------------------------------------- board tools

const BOARD_LABEL: Record<string, (input: Record<string, unknown> | undefined) => string> = {
  draw: (i) => `Drew: ${String(i?.title ?? "…")}`,
  plot: (i) => `Graphed ${String(i?.title ?? (i?.functions as { expr: string }[] | undefined)?.map((f) => f.expr).join(", ") ?? "")}`,
  annotate: (i) => (i?.note ? `Marked: ${String(i.note)}` : `Marked your work (${String(i?.style ?? "")})`),
  point_at: (i) => (i?.caption ? `Pointed: ${String(i.caption)}` : "Pointed at the board"),
  erase: () => "Erased some of my drawings",
  ask_student: (i) => `Your turn: ${String(i?.task ?? "")}`,
}
const BOARD_ICON: Record<string, React.ReactNode> = {
  draw: <PenLineIcon />,
  plot: <LineChartIcon />,
  annotate: <CircleDotIcon />,
  point_at: <MousePointer2Icon />,
  erase: <EraserIcon />,
  ask_student: <HandIcon />,
}

function BoardToolChip({ part, name }: { part: ToolPart; name: string }) {
  const { board } = useTutor()
  const input = part.input as Record<string, unknown> | undefined
  const label = BOARD_LABEL[name]?.(input) ?? name
  const error = part.state === "output-error" ? part.errorText : undefined
  return (
    <Chip
      icon={BOARD_ICON[name]}
      state={part.state}
      title={error ?? "Show on the board"}
      onClick={part.state === "output-available" ? () => board?.focusStep(part.toolCallId) : undefined}
    >
      {error ? `${label} — failed` : label}
    </Chip>
  )
}

// ------------------------------------------------------- research tools

function WebSearchCard({ part }: { part: PartOf<"web_search"> }) {
  const query = part.input?.query
  if (part.state !== "output-available") {
    return (
      <Chip icon={<SearchIcon />} state={part.state} title={part.state === "output-error" ? part.errorText : undefined}>
        {part.state === "output-error" ? `Search failed: ${query}` : `Searching the web: ${query ?? ""}`}
      </Chip>
    )
  }
  const out = part.output
  return (
    <Collapsible className="rounded-xl border bg-card">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground">
        <SearchIcon className="size-3.5 text-primary" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          Searched <span className="text-foreground">“{out.query}”</span> · {out.results.length} results via {out.provider}
        </span>
        <span className="flex -space-x-1">
          {out.results.slice(0, 4).map((r) => (
            <span key={r.url} className="rounded-sm ring-2 ring-card">
              <Favicon url={r.url} />
            </span>
          ))}
        </span>
        <ChevronDownIcon className="size-3.5 transition-transform group-data-open:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsiblePanel className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0">
        <div className="border-t p-2">
          <SourceList sources={out.results} />
        </div>
      </CollapsiblePanel>
    </Collapsible>
  )
}

function WebFetchChip({ part }: { part: PartOf<"web_fetch"> }) {
  const url = part.input?.url ?? ""
  if (part.state === "output-available") {
    return (
      <a href={part.output.url} target="_blank" rel="noreferrer">
        <Chip icon={<FileTextIcon />} state={part.state}>
          Read: {part.output.title || host(url)}
        </Chip>
      </a>
    )
  }
  return (
    <Chip icon={<GlobeIcon />} state={part.state} title={part.state === "output-error" ? part.errorText : undefined}>
      {part.state === "output-error" ? `Couldn't read ${host(url)}` : `Reading ${host(url)}…`}
    </Chip>
  )
}

function ResearchCard({ part }: { part: PartOf<"research"> }) {
  if (part.state !== "output-available") {
    return (
      <Chip icon={<SparklesIcon />} state={part.state} title={part.state === "output-error" ? part.errorText : undefined}>
        {part.state === "output-error" ? "Research failed" : `Researching: ${part.input?.question ?? ""}`}
      </Chip>
    )
  }
  const out = part.output
  return (
    <Card
      icon={<SparklesIcon />}
      title="Research brief"
      subtitle={`${out.question} · ${out.sources.length} sources`}
    >
      <Collapsible defaultOpen={false}>
        <div className="line-clamp-4 text-sm whitespace-pre-wrap text-muted-foreground">{out.brief}</div>
        <CollapsiblePanel className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0">
          <div className="mt-2">
            <SourceList sources={out.sources} />
          </div>
        </CollapsiblePanel>
        <CollapsibleTrigger className="mt-2 text-xs font-medium text-primary hover:underline">
          {(s) => (s.open ? "Hide sources" : `Show ${out.sources.length} sources`)}
        </CollapsibleTrigger>
      </Collapsible>
    </Card>
  )
}

function ImagesCard({ part }: { part: PartOf<"find_images"> }) {
  const { board } = useTutor()
  if (part.state !== "output-available") {
    return (
      <Chip icon={<ImageIcon />} state={part.state}>
        {part.state === "output-error" ? "Image search failed" : `Finding images: ${part.input?.query ?? ""}`}
      </Chip>
    )
  }
  const images = part.output.images
  if (!images.length) {
    return (
      <Chip icon={<ImageIcon />} state={part.state}>
        No openly licensed images for “{part.output.query}”
      </Chip>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {images.map((img) => (
        <figure key={img.url} className="group relative overflow-hidden rounded-xl border bg-card">
          <a href={img.page} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.thumb} alt={img.title} className="aspect-4/3 w-full object-cover" loading="lazy" />
          </a>
          <figcaption className="space-y-0.5 p-2">
            <div className="line-clamp-1 text-xs font-medium">{img.title}</div>
            <div className="line-clamp-1 text-[10px] text-muted-foreground">
              {[img.author, img.license].filter(Boolean).join(" · ") || "Wikimedia Commons"}
            </div>
          </figcaption>
          <button
            type="button"
            onClick={() =>
              board
                ?.addImage({
                  url: img.thumb,
                  title: img.title,
                  width: img.width,
                  height: img.height,
                  credit: [img.author, img.license].filter(Boolean).join(", "),
                })
                .catch((e: Error) => toast.error("Couldn't pin image", { description: e.message }))
            }
            className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-1 text-[11px] font-medium opacity-0 shadow-sm ring-1 ring-border backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <PinIcon className="size-3" aria-hidden /> Pin to board
          </button>
        </figure>
      ))}
    </div>
  )
}

function CalcChip({ part }: { part: PartOf<"calculate"> }) {
  const expr = part.input?.expression ?? ""
  if (part.state !== "output-available") {
    return (
      <Chip icon={<CalculatorIcon />} state={part.state}>
        Calculating {expr}
      </Chip>
    )
  }
  const out = part.output
  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 font-mono text-xs">
      <CalculatorIcon className="size-3.5 shrink-0 text-primary" aria-hidden />
      <span className="truncate text-muted-foreground">
        {out.operation === "evaluate" ? "" : `${out.operation} `}
        {out.expression}
      </span>
      <span className="text-muted-foreground">→</span>
      <span className={cn("truncate font-medium", "error" in out && out.error && "text-destructive")}>
        {"error" in out && out.error ? out.error : "result" in out ? out.result : ""}
      </span>
    </div>
  )
}

// -------------------------------------------------------- rich media

function Scene3DCard({ part }: { part: PartOf<"show_3d"> }) {
  // Rendered progressively while the scene streams in; objects appear as they arrive.
  const spec = part.input as Partial<z.infer<typeof show3dInput>> | undefined
  if (!spec?.objects?.length) {
    return (
      <Chip icon={<BoxIcon />} state={part.state}>
        Building a 3D model…
      </Chip>
    )
  }
  const ready = !running(part) || part.state === "input-available"
  return (
    <Card
      icon={<BoxIcon />}
      title={spec.title ?? "3D model"}
      subtitle={spec.caption ?? "Drag to orbit · scroll to zoom"}
      actions={
        ready ? (
          <ExpandDialog title={spec.title ?? "3D model"} description={spec.caption}>
            <Scene3D spec={spec} />
          </ExpandDialog>
        ) : null
      }
      className="[&>div:last-child]:p-0"
    >
      <div className="h-72 bg-(--chart-surface)">{ready ? <Scene3D spec={spec} /> : null}</div>
    </Card>
  )
}

function ChartCard({ part }: { part: PartOf<"chart"> }) {
  const spec = part.input as z.infer<typeof chartInput> | undefined
  if (!spec?.data?.length || part.state === "input-streaming") {
    return (
      <Chip icon={<BarChart3Icon />} state={part.state}>
        Charting {spec?.title ?? "data"}…
      </Chip>
    )
  }
  return (
    <Card
      icon={<BarChart3Icon />}
      title={spec.title}
      subtitle={spec.caption}
      actions={
        <ExpandDialog title={spec.title ?? "Chart"} description={spec.caption}>
          <div className="p-6">
            <ChartView spec={spec} height={560} />
          </div>
        </ExpandDialog>
      }
    >
      <ChartView spec={spec} />
    </Card>
  )
}

function ExplorerCard({ part }: { part: PartOf<"explore"> }) {
  const spec = part.input as z.infer<typeof exploreInput> | undefined
  if (!spec?.expr || !spec.params?.length || part.state === "input-streaming") {
    return (
      <Chip icon={<SlidersHorizontalIcon />} state={part.state}>
        Building an explorer…
      </Chip>
    )
  }
  return (
    <Card
      icon={<SlidersHorizontalIcon />}
      title={spec.title}
      subtitle={<span className="font-mono">y = {spec.expr}</span>}
      actions={
        <ExpandDialog title={spec.title ?? "Explorer"} description={spec.caption}>
          <div className="mx-auto max-w-4xl p-6">
            <Explorer spec={spec} />
          </div>
        </ExpandDialog>
      }
    >
      {spec.caption ? <p className="mb-2 text-xs text-muted-foreground">{spec.caption}</p> : null}
      <Explorer spec={spec} />
    </Card>
  )
}

function QuizCard({ part }: { part: PartOf<"quiz"> }) {
  const { answerQuiz } = useTutor()
  const input = part.input as z.infer<typeof quizInput> | undefined
  const answered = part.state === "output-available" ? part.output : null
  const [picked, setPicked] = React.useState<number | null>(null)
  if (!input?.options?.length || part.state === "input-streaming") {
    return (
      <Chip icon={<CheckCircle2Icon />} state={part.state}>
        Writing a question…
      </Chip>
    )
  }
  const chosenIndex = (answered as { chosenIndex?: number } | null)?.chosenIndex ?? picked
  const done = chosenIndex !== null && chosenIndex !== undefined
  return (
    <Card icon={<CheckCircle2Icon />} title="Quick check" subtitle={done ? undefined : "Pick an answer"}>
      <p className="mb-3 text-sm font-medium">{input.question}</p>
      <div className="grid gap-1.5">
        {input.options.map((opt, i) => {
          const isCorrect = i === input.correctIndex
          const isChosen = i === chosenIndex
          return (
            <button
              key={i}
              type="button"
              disabled={done}
              onClick={() => {
                setPicked(i)
                answerQuiz(part.toolCallId, { chosenIndex: i, chosen: opt, correct: isCorrect })
              }}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                !done && "hover:border-primary/50 hover:bg-accent",
                done && isCorrect && "border-emerald-500/50 bg-emerald-500/10",
                done && isChosen && !isCorrect && "border-destructive/50 bg-destructive/10"
              )}
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="flex-1">{opt}</span>
              {done && isCorrect ? <CheckCircle2Icon className="size-4 text-emerald-600" aria-label="Correct" /> : null}
              {done && isChosen && !isCorrect ? <XCircleIcon className="size-4 text-destructive" aria-label="Your answer" /> : null}
            </button>
          )
        })}
      </div>
      {done ? <p className="mt-3 text-sm text-muted-foreground">{input.explanation}</p> : null}
    </Card>
  )
}

export function SuggestedReplies({ part }: { part: PartOf<"suggest_replies"> }) {
  const { send, busy } = useTutor()
  const options = (part.input?.options ?? []).filter((o): o is string => !!o)
  if (!options.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          disabled={busy}
          onClick={() => send(o)}
          className="rounded-full border border-primary/25 bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground transition-colors hover:border-primary/50 disabled:opacity-50"
        >
          {o}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- router

export function ToolPartView({ part, isLast }: { part: ToolPart; isLast: boolean }) {
  const name = part.type.slice(5)
  switch (name) {
    case "draw":
    case "plot":
    case "annotate":
    case "point_at":
    case "erase":
    case "ask_student":
      return <BoardToolChip part={part} name={name} />
    case "web_search":
      return <WebSearchCard part={part as PartOf<"web_search">} />
    case "web_fetch":
      return <WebFetchChip part={part as PartOf<"web_fetch">} />
    case "research":
      return <ResearchCard part={part as PartOf<"research">} />
    case "find_images":
      return <ImagesCard part={part as PartOf<"find_images">} />
    case "calculate":
      return <CalcChip part={part as PartOf<"calculate">} />
    case "look_closer":
      return (
        <Chip icon={<EyeIcon />} state={part.state}>
          Looked closely: {(part as PartOf<"look_closer">).input?.question ?? ""}
        </Chip>
      )
    case "show_3d":
      return <Scene3DCard part={part as PartOf<"show_3d">} />
    case "chart":
      return <ChartCard part={part as PartOf<"chart">} />
    case "explore":
      return <ExplorerCard part={part as PartOf<"explore">} />
    case "quiz":
      return <QuizCard part={part as PartOf<"quiz">} />
    case "suggest_replies":
      return isLast ? <SuggestedReplies part={part as PartOf<"suggest_replies">} /> : null
    default:
      return null
  }
}
