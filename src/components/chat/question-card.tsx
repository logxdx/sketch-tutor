"use client"

import { CheckCircle2Icon, CircleHelpIcon, MessageSquareTextIcon, RouteIcon, XCircleIcon } from "lucide-react"
import * as React from "react"
import type { z } from "zod"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { QuizAnswer, quizInput } from "@/lib/agent/schemas"
import type { TutorUIMessage } from "@/lib/agent/types"
import { cn } from "@/lib/utils"
import { useTutor } from "./tutor-context"

type Part = TutorUIMessage["parts"][number]
type QuizPart = Extract<Part, { type: "tool-quiz" }>
type Input = z.infer<typeof quizInput>

const CONFIDENCE: { value: NonNullable<QuizAnswer["confidence"]>; label: string }[] = [
  { value: "guessing", label: "Guessing" },
  { value: "fairly sure", label: "Fairly sure" },
  { value: "certain", label: "Certain" },
]

/** Stable shuffle per question, so options don't jump around on re-render or reload. */
function shuffledOrder(n: number, seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
  const order = [...Array(n).keys()]
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

function Shell({
  probe,
  stepTitle,
  children,
}: {
  probe: boolean
  stepTitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
        <CircleHelpIcon className="size-3.5 text-primary" aria-hidden />
        <span className="font-medium">{probe ? "Where are you starting from?" : "Check your understanding"}</span>
        {stepTitle ? (
          <span className="ml-auto inline-flex min-w-0 items-center gap-1 text-muted-foreground">
            <RouteIcon className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{stepTitle}</span>
          </span>
        ) : null}
      </div>
      <div className="space-y-3 p-3">{children}</div>
    </div>
  )
}

/**
 * A question the tutor asked: multiple choice (shuffled) or recall in the
 * student's own words, with how sure they are and — if they like — their
 * reasoning. That's what tells the tutor where understanding actually ends.
 */
export function QuestionCard({ part }: { part: QuizPart }) {
  const { answerQuiz, plan } = useTutor()
  const input = part.input as Input | undefined
  const saved = part.state === "output-available" ? (part.output as QuizAnswer) : null
  const [submitted, setSubmitted] = React.useState<QuizAnswer | null>(null)
  const [picked, setPicked] = React.useState<number | null>(null)
  const [answer, setAnswer] = React.useState("")
  const [reasoning, setReasoning] = React.useState("")
  const [thinking, setThinking] = React.useState(false)
  const [confidence, setConfidence] = React.useState<QuizAnswer["confidence"]>()
  const id = React.useId()

  if (!input?.question || part.state === "input-streaming") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
        <CircleHelpIcon className="size-4 animate-pulse" aria-hidden /> Writing a question…
      </div>
    )
  }
  if (part.state === "output-error") return null

  const options = input.options ?? []
  const kind: QuizAnswer["kind"] = input.kind === "recall" || options.length < 2 ? "recall" : "choice"
  const probe = input.purpose === "probe"
  const stepTitle = input.step ? plan?.nodes.find((n) => n.id === input.step)?.title : undefined
  const result = saved ?? submitted
  const order = kind === "choice" ? shuffledOrder(options.length, part.toolCallId) : []

  const submit = (out: QuizAnswer) => {
    setSubmitted(out)
    answerQuiz(part.toolCallId, out)
  }
  const extras = () => ({
    ...(confidence ? { confidence } : {}),
    ...(reasoning.trim() ? { reasoning: reasoning.trim() } : {}),
  })
  const ready = kind === "choice" ? picked !== null : answer.trim().length > 0

  // ------------------------------------------------------------ answered
  if (result) {
    const correctIdx = input.correctIndex
    return (
      <Shell probe={probe} stepTitle={stepTitle}>
        <p className="text-sm font-medium text-pretty">{input.question}</p>
        {kind === "choice" ? (
          <div className="grid gap-1.5">
            {order.map((i) => {
              const isCorrect = i === correctIdx
              const isChosen = i === result.chosenIndex
              return (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                    isCorrect && "border-emerald-500/50 bg-emerald-500/10",
                    isChosen && !isCorrect && "border-destructive/50 bg-destructive/10",
                    !isCorrect && !isChosen && "opacity-60"
                  )}
                >
                  <span className="flex-1">{options[i]}</span>
                  {isCorrect ? <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600" aria-label="Right answer" /> : null}
                  {isChosen && !isCorrect ? <XCircleIcon className="size-4 shrink-0 text-destructive" aria-label="Your answer" /> : null}
                </div>
              )
            })}
          </div>
        ) : result.answer ? (
          <div className="space-y-2 text-sm">
            <div className="rounded-lg border bg-muted/40 px-3 py-2">
              <div className="text-[11px] font-medium text-muted-foreground">Your answer</div>
              <p className="whitespace-pre-wrap">{result.answer}</p>
            </div>
            {input.answer ? (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2">
                <div className="text-[11px] font-medium text-muted-foreground">Sketch&apos;s answer</div>
                <p className="whitespace-pre-wrap">{input.answer}</p>
              </div>
            ) : null}
          </div>
        ) : null}
        {result.skipped ? (
          <p className="text-sm text-muted-foreground">
            {probe ? "Good to know — that's where we'll start." : "No problem — we'll go through it."}
          </p>
        ) : null}
        {result.confidence || result.reasoning ? (
          <p className="text-xs text-muted-foreground">
            {result.confidence ? <span className="font-medium">{CONFIDENCE.find((c) => c.value === result.confidence)?.label}</span> : null}
            {result.confidence && result.reasoning ? " · " : ""}
            {result.reasoning ? <span className="italic">“{result.reasoning}”</span> : null}
          </p>
        ) : null}
        {!result.skipped || !probe ? <p className="text-sm text-pretty text-muted-foreground">{input.explanation}</p> : null}
      </Shell>
    )
  }

  // -------------------------------------------------------------- asking
  return (
    <Shell probe={probe} stepTitle={stepTitle}>
      <p id={`${id}-q`} className="text-sm font-medium text-pretty">
        {input.question}
      </p>
      {kind === "choice" ? (
        <div role="radiogroup" aria-labelledby={`${id}-q`} className="grid gap-1.5">
          {order.map((i, n) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={picked === i}
              onClick={() => setPicked(i)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:border-primary/50 hover:bg-accent",
                picked === i && "border-primary bg-primary/5 ring-1 ring-primary"
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                  picked === i && "border-primary bg-primary text-primary-foreground"
                )}
              >
                {String.fromCharCode(65 + n)}
              </span>
              <span className="flex-1">{options[i]}</span>
            </button>
          ))}
        </div>
      ) : (
        <Textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Answer in your own words…"
          aria-labelledby={`${id}-q`}
          className="min-h-20 text-sm"
        />
      )}

      {thinking ? (
        <Textarea
          autoFocus
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
          placeholder="Think out loud: why this answer? What are you unsure about?"
          aria-label="Your reasoning"
          className="min-h-16 text-sm"
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="How sure are you?" className="inline-flex rounded-lg border p-0.5">
          {CONFIDENCE.map((c) => (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={confidence === c.value}
              onClick={() => setConfidence(confidence === c.value ? undefined : c.value)}
              className={cn(
                "rounded-md px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
                confidence === c.value && "bg-secondary font-medium text-secondary-foreground"
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        {!thinking ? (
          <Button variant="ghost" size="xs" onClick={() => setThinking(true)}>
            <MessageSquareTextIcon /> Explain my thinking
          </Button>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => submit({ kind, skipped: true, ...extras() })}
            className="text-muted-foreground"
          >
            I don&apos;t know yet
          </Button>
          <Button
            size="xs"
            disabled={!ready}
            onClick={() =>
              submit(
                kind === "choice"
                  ? { kind, chosenIndex: picked!, chosen: options[picked!], correct: picked === input.correctIndex, ...extras() }
                  : { kind, answer: answer.trim(), ...extras() }
              )
            }
          >
            {kind === "choice" ? "Check" : "Submit"}
          </Button>
        </div>
      </div>
    </Shell>
  )
}
