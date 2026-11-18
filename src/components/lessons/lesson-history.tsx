"use client"

import { CheckIcon, PencilIcon, PlusIcon, RouteIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react"
import * as React from "react"
import { Dialog, DialogBackdrop, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/react/dialog"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MODES, SUBJECTS } from "@/lib/agent/types"
import type { LessonSummary } from "@/lib/lessons/types"
import type { LessonsApi } from "@/lib/lessons/use-lessons"
import { cn } from "@/lib/utils"

const DAY = 24 * 60 * 60 * 1000

function groupOf(t: number) {
  const startOfToday = new Date().setHours(0, 0, 0, 0)
  if (t >= startOfToday) return "Today"
  if (t >= startOfToday - DAY) return "Yesterday"
  if (t >= startOfToday - 6 * DAY) return "Previous 7 days"
  return "Older"
}

function when(t: number) {
  const d = new Date(t)
  return t >= new Date().setHours(0, 0, 0, 0)
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" })
}

function LessonRow({
  lesson,
  active,
  onOpen,
  onRename,
  onDelete,
}: {
  lesson: LessonSummary
  active: boolean
  onOpen: () => void
  onRename: (title: string) => void
  onDelete: () => void
}) {
  const [mode, setMode] = React.useState<"idle" | "rename" | "confirm">("idle")
  const [draft, setDraft] = React.useState(lesson.title)
  const subject = SUBJECTS.find((s) => s.value === lesson.subject)?.label
  const teaching = MODES.find((m) => m.value === lesson.mode)?.label

  if (mode === "rename") {
    return (
      <form
        className="flex items-center gap-1.5 rounded-lg bg-muted/60 p-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          onRename(draft)
          setMode("idle")
        }}
      >
        <Input
          autoFocus
          value={draft}
          aria-label="Lesson name"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation()
              setMode("idle")
            }
          }}
          className="h-7"
        />
        <Button type="submit" size="icon-xs" aria-label="Save name">
          <CheckIcon />
        </Button>
      </form>
    )
  }

  if (mode === "confirm") {
    return (
      <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-sm">
        <p>
          Delete <span className="font-medium">{lesson.title}</span>? Its conversation and board are removed for good.
        </p>
        <div className="flex justify-end gap-1.5">
          <Button size="xs" variant="ghost" onClick={() => setMode("idle")}>
            Cancel
          </Button>
          <Button size="xs" variant="destructive" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "group relative flex items-start gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-muted/70",
        active && "bg-accent hover:bg-accent"
      )}
    >
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring">
        <span className="line-clamp-2 text-sm font-medium text-pretty">{lesson.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
          {lesson.progress ? (
            <span className="inline-flex items-center gap-0.5 font-medium text-foreground/80">
              <RouteIcon className="size-3" aria-hidden />
              {lesson.progress.done}/{lesson.progress.total}
            </span>
          ) : null}
          {[teaching, subject && subject !== "Anything" ? subject : null, when(lesson.updatedAt)].filter(Boolean).join(" · ")}
        </span>
      </button>
      <div className="relative z-10 flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`Rename ${lesson.title}`}
          onClick={() => {
            setDraft(lesson.title)
            setMode("rename")
          }}
        >
          <PencilIcon />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label={`Delete ${lesson.title}`} onClick={() => setMode("confirm")}>
          <Trash2Icon />
        </Button>
      </div>
    </div>
  )
}

/** Lesson history as a sheet from the left: search, open, rename, delete, start new. */
export function LessonHistory({
  open,
  onOpenChange,
  api,
  currentId,
  onOpenLesson,
  onNewLesson,
  onCurrentDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  api: LessonsApi
  currentId: string
  onOpenLesson: (id: string) => void
  onNewLesson: () => void
  /** The open lesson was deleted: start fresh without saving it again. */
  onCurrentDeleted: () => void
}) {
  const [query, setQuery] = React.useState("")
  const q = query.trim().toLowerCase()
  const rows = api.lessons.filter((l) => !q || `${l.title} ${l.preview ?? ""}`.toLowerCase().includes(q))
  const groups = new Map<string, LessonSummary[]>()
  for (const l of rows) {
    const g = groupOf(l.updatedAt)
    groups.set(g, [...(groups.get(g) ?? []), l])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogBackdrop className="fixed inset-0 bg-black/30 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <DialogContent className="fixed inset-y-0 left-0 flex w-[min(92vw,360px)] flex-col border-r bg-background shadow-2xl transition-transform duration-200 ease-out outline-none data-ending-style:-translate-x-full data-starting-style:-translate-x-full">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <DialogTitle className="font-medium">Lessons</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Saved on this computer, with the conversation and the board.
            </DialogDescription>
          </div>
          <DialogClose aria-label="Close" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <XIcon className="size-4" aria-hidden />
          </DialogClose>
        </div>
        <div className="space-y-2 border-b p-3">
          <Button
            className="w-full justify-start"
            onClick={() => {
              onNewLesson()
              onOpenChange(false)
            }}
          >
            <PlusIcon /> New lesson
          </Button>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search lessons"
              aria-label="Search lessons"
              className="pl-8"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!api.loaded ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Loading…</p>
          ) : !rows.length ? (
            <p className="p-6 text-center text-sm text-pretty text-muted-foreground">
              {q ? "No lessons match." : "Your lessons appear here as you learn — each one keeps its conversation and its board."}
            </p>
          ) : (
            [...groups].map(([group, items]) => (
              <section key={group} className="mb-3">
                <h3 className="px-2.5 pt-1 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{group}</h3>
                <div className="space-y-0.5">
                  {items.map((l) => (
                    <LessonRow
                      key={l.id}
                      lesson={l}
                      active={l.id === currentId}
                      onOpen={() => {
                        onOpenLesson(l.id)
                        onOpenChange(false)
                      }}
                      onRename={(title) => void api.rename(l.id, title)}
                      onDelete={() => {
                        if (l.id === currentId) onCurrentDeleted()
                        void api.remove(l.id)
                      }}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
