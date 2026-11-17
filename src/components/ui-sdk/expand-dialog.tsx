"use client"

import { Maximize2Icon, XIcon } from "lucide-react"
import type * as React from "react"
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog"

/** "Expand" button that opens rich content (3D, charts, explorers) in a large dialog. */
export function ExpandDialog({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Dialog>
      <DialogTrigger
        aria-label={`Expand ${title}`}
        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Maximize2Icon className="size-3.5" aria-hidden />
      </DialogTrigger>
      <DialogBackdrop className="fixed inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <DialogContent className="fixed top-1/2 left-1/2 flex h-[min(88vh,900px)] w-[min(94vw,1200px)] -translate-1/2 flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-2xl transition-[opacity,scale] duration-200 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-3">
          <div className="min-w-0">
            <DialogTitle className="truncate font-medium">{title}</DialogTitle>
            {description ? (
              <DialogDescription className="text-sm text-muted-foreground">{description}</DialogDescription>
            ) : null}
          </div>
          <DialogClose
            aria-label="Close"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" aria-hidden />
          </DialogClose>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
