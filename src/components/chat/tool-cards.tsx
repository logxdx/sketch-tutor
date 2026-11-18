"use client"

import {
  BarChart3Icon,
  BoxIcon,
  CheckCircle2Icon,
  ImageIcon,
  PinIcon,
  SlidersHorizontalIcon,
  XCircleIcon,
} from "lucide-react"
import dynamic from "next/dynamic"
import * as React from "react"
import { toast } from "@ui-sdk/react/toast"
import type { z } from "zod"

import { ExpandDialog } from "@/components/ui-sdk/expand-dialog"
import { Button } from "@/components/ui/button"
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace"
import { ChartView } from "@/components/viz/chart-view"
import { Explorer } from "@/components/viz/explorer"
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

/** Tools rendered as rich cards in the lesson (everything else is a Trace step). */
export const MEDIA_TOOLS = new Set(["show_3d", "chart", "explore", "quiz", "find_images", "suggest_replies"])

/** While a card is still being built it shows as a single running Trace line. */
function Building({ icon, children, failed }: { icon: React.ReactNode; children: React.ReactNode; failed?: boolean }) {
  return (
    <Trace>
      <div>
        <TraceLine status={failed ? "error" : "running"}>
          <TraceIcon>{icon}</TraceIcon>
          <TraceTitle>{children}</TraceTitle>
        </TraceLine>
      </div>
    </Trace>
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

function ImagesCard({ part }: { part: PartOf<"find_images"> }) {
  const { board } = useTutor()
  if (part.state !== "output-available") {
    return (
      <Building icon={<ImageIcon />} failed={part.state === "output-error"}>
        {part.state === "output-error" ? "Image search failed" : `Finding images of ${part.input?.query ?? "…"}`}
      </Building>
    )
  }
  const images = part.output.images
  if (!images.length) {
    return (
      <Trace>
        <div>
          <TraceLine>
            <TraceIcon>
              <ImageIcon />
            </TraceIcon>
            <TraceTitle>No openly licensed images for “{part.output.query}”</TraceTitle>
          </TraceLine>
        </div>
      </Trace>
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
          <Button
            size="xs"
            variant="secondary"
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
            className="absolute top-1.5 right-1.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <PinIcon /> Pin to board
          </Button>
        </figure>
      ))}
    </div>
  )
}

function Scene3DCard({ part }: { part: PartOf<"show_3d"> }) {
  const spec = part.input as Partial<z.infer<typeof show3dInput>> | undefined
  const ready = part.state === "input-available" || part.state === "output-available"
  if (!spec?.objects?.length || !ready) {
    return <Building icon={<BoxIcon />}>Building a 3D model{spec?.title ? ` of ${spec.title}` : ""}</Building>
  }
  return (
    <Card
      icon={<BoxIcon />}
      title={spec.title ?? "3D model"}
      subtitle={spec.caption ?? "Drag to orbit · scroll to zoom"}
      actions={
        <ExpandDialog title={spec.title ?? "3D model"} description={spec.caption}>
          <Scene3D spec={spec} />
        </ExpandDialog>
      }
      className="[&>div:last-child]:p-0"
    >
      <div className="h-72 bg-(--chart-surface)">
        <Scene3D spec={spec} />
      </div>
    </Card>
  )
}

function ChartCard({ part }: { part: PartOf<"chart"> }) {
  const spec = part.input as z.infer<typeof chartInput> | undefined
  if (!spec?.data?.length || part.state === "input-streaming") {
    return <Building icon={<BarChart3Icon />}>Charting {spec?.title ?? "the data"}</Building>
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
    return <Building icon={<SlidersHorizontalIcon />}>Building an explorer</Building>
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
    return <Building icon={<CheckCircle2Icon />}>Writing a question</Building>
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

/** shadcn Suggestion pattern: outline pill buttons under the last reply. */
export function SuggestedReplies({ part }: { part: PartOf<"suggest_replies"> }) {
  const { send, busy } = useTutor()
  const options = (part.input?.options ?? []).filter((o): o is string => !!o)
  if (!options.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Button key={o} variant="outline" size="sm" className="rounded-full" disabled={busy} onClick={() => send(o)}>
          {o}
        </Button>
      ))}
    </div>
  )
}

export function MediaPartView({ part, isLast }: { part: ToolPart; isLast: boolean }) {
  switch (part.type.slice(5)) {
    case "find_images":
      return <ImagesCard part={part as PartOf<"find_images">} />
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
