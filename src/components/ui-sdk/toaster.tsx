"use client"

import { XIcon } from "lucide-react"
import { Toast, ToastAction, ToastClose, ToastDescription, ToastRegion, ToastTitle } from "@ui-sdk/react/toast"

/** One toast region for the app (UI SDK behaviours, shadcn look). Trigger with `toast()` from "@ui-sdk/react/toast". */
export function Toaster() {
  return (
    <ToastRegion
      side="bottom"
      align="end"
      aria-label="Notifications"
      className="m-4 h-(--toast-front-height) w-[min(360px,calc(100vw-2rem))] data-expanded:h-[calc(var(--toast-stack-height)+(var(--toast-count)-1)*12px)]"
    >
      {() => (
        <Toast className="sk-toast flex items-start gap-3 overflow-hidden rounded-xl border bg-popover p-3.5 pr-9 text-popover-foreground shadow-lg select-none data-[type=error]:border-destructive/40">
          <div className="min-w-0 flex-1">
            <ToastTitle className="text-sm font-medium" />
            <ToastDescription className="mt-0.5 text-sm text-muted-foreground" />
            <ToastAction className="mt-2 inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground" />
          </div>
          <ToastClose
            aria-label="Dismiss"
            className="absolute top-2.5 right-2.5 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-3.5" aria-hidden />
          </ToastClose>
        </Toast>
      )}
    </ToastRegion>
  )
}
