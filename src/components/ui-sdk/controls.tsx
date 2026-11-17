"use client"

import { CheckIcon, ChevronDownIcon } from "lucide-react"
import type * as React from "react"
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select"
import { Switch, SwitchThumb } from "@ui-sdk/react/switch"
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from "@ui-sdk/react/tooltip"

import { cn } from "@/lib/utils"

const popupMotion =
  "origin-(--transform-origin) transition-[opacity,scale] duration-150 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0 motion-reduce:transition-none"

/** Icon button with an accessible tooltip label (and optional shortcut hint). */
export function IconButton({
  label,
  shortcut,
  className,
  children,
  active,
  ...props
}: React.ComponentProps<"button"> & { label: string; shortcut?: string; active?: boolean }) {
  return (
    <Tooltip delay={350} type="label" shortcut={shortcut}>
      <TooltipTrigger
        aria-label={label}
        data-active={active || undefined}
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 data-active:bg-accent data-active:text-accent-foreground [&_svg]:size-4",
          className
        )}
        {...props}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={6}
        className={cn(
          "z-50 flex items-center gap-2 rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md data-instant:transition-none",
          popupMotion
        )}
      >
        {label}
        {shortcut ? <TooltipShortcut className="opacity-60" /> : null}
      </TooltipContent>
    </Tooltip>
  )
}

export function PickList<T extends string>({
  items,
  value,
  onValueChange,
  label,
  className,
  icon,
}: {
  items: readonly { value: T; label: string }[]
  value: T
  onValueChange: (v: T) => void
  label: string
  className?: string
  icon?: React.ReactNode
}) {
  return (
    <Select<T>
      items={items as { value: T; label: string }[]}
      value={value}
      onValueChange={(v) => v && onValueChange(v as T)}
    >
      <SelectTrigger
        aria-label={label}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-open:bg-muted",
          className
        )}
      >
        {icon}
        <SelectValue className="truncate" />
        <ChevronDownIcon aria-hidden className="size-3.5 opacity-50" />
      </SelectTrigger>
      <SelectContent
        sideOffset={6}
        className={cn(
          "z-50 max-h-[min(var(--available-height),22rem)] min-w-(--anchor-width) overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg",
          popupMotion
        )}
      >
        {items.map((item) => (
          <SelectItem
            key={item.value}
            value={item.value}
            className="flex cursor-default items-center justify-between gap-4 rounded-md px-2 py-1.5 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
          >
            {item.label}
            <SelectItemIndicator>
              <CheckIcon className="size-3.5" />
            </SelectItemIndicator>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function Segmented<T extends string>({
  items,
  value,
  onValueChange,
  label,
  className,
  size = "md",
}: {
  items: readonly { value: T; label: React.ReactNode; hint?: string }[]
  value: T
  onValueChange: (v: T) => void
  label: string
  className?: string
  size?: "sm" | "md"
}) {
  return (
    <SegmentedControl
      aria-label={label}
      value={value}
      onValueChange={(v) => v && onValueChange(v as T)}
      className={cn("relative isolate inline-flex rounded-lg bg-muted p-0.5", className)}
    >
      <SegmentedControlIndicator className="absolute top-(--segmented-control-indicator-top) left-(--segmented-control-indicator-left) -z-10 h-(--segmented-control-indicator-height) w-(--segmented-control-indicator-width) rounded-md bg-background shadow-sm ring-1 ring-border transition-[top,left,width,height] duration-200 motion-reduce:transition-none" />
      {items.map((item) => (
        <SegmentedControlItem
          key={item.value}
          value={item.value}
          title={item.hint}
          className={cn(
            "rounded-md font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-checked:text-foreground",
            size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm"
          )}
        >
          {item.label}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  )
}

export function Toggle({
  checked,
  onCheckedChange,
  children,
  className,
}: {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm select-none", className)}>
      <Switch
        checked={checked}
        onCheckedChange={(c) => onCheckedChange(c)}
        className="inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-input p-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-primary"
      >
        <SwitchThumb className="size-4 rounded-full bg-background shadow transition-transform data-checked:translate-x-4" />
      </Switch>
      {children}
    </label>
  )
}
