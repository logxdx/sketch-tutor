"use client"

import { SearchIcon } from "lucide-react"
import * as React from "react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandItemIcon,
  CommandList,
  CommandShortcut,
} from "@ui-sdk/react/command"
import { Dialog, DialogBackdrop, DialogContent, DialogTitle, DialogTrigger } from "@ui-sdk/react/dialog"

export type PaletteAction = {
  id: string
  label: string
  group: string
  icon?: React.ReactNode
  keywords?: string[]
  shortcut?: string
  run: () => void | Promise<void>
}

/** ⌘K command palette built from UI SDK Dialog + Command. */
export function CommandPalette({ actions }: { actions: PaletteAction[] }) {
  const [open, setOpen] = React.useState(false)
  const groups = React.useMemo(() => {
    const map = new Map<string, PaletteAction[]>()
    for (const a of actions) map.set(a.group, [...(map.get(a.group) ?? []), a])
    return [...map]
  }, [actions])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        shortcut="mod+k"
        className="inline-flex h-8 items-center gap-2 rounded-lg border bg-background px-2.5 text-sm text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SearchIcon className="size-3.5" aria-hidden />
        <span className="hidden lg:inline">Commands</span>
        <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">⌘K</kbd>
      </DialogTrigger>
      <DialogBackdrop className="fixed inset-0 bg-black/40 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <DialogContent className="fixed top-[18vh] left-1/2 w-[min(92vw,560px)] -translate-x-1/2 overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-2xl transition-[opacity,scale] duration-150 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command
          onAction={async (value) => {
            const action = actions.find((a) => a.id === value)
            setOpen(false)
            await action?.run()
          }}
        >
          <div className="flex items-center gap-2 border-b px-3">
            <SearchIcon className="size-4 text-muted-foreground" aria-hidden />
            <CommandInput
              aria-label="Search commands"
              placeholder="Type a command or a subject…"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <CommandEmpty className="hidden py-8 text-center text-sm text-muted-foreground data-empty:block">No matching commands.</CommandEmpty>
          <CommandList className="max-h-[50vh] overflow-y-auto p-1.5">
            {groups.map(([group, items]) => (
              <CommandGroup key={group}>
                <CommandGroupLabel className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                  {group}
                </CommandGroupLabel>
                {items.map((a) => (
                  <CommandItem
                    key={a.id}
                    value={a.id}
                    label={a.label}
                    keywords={a.keywords}
                    shortcut={a.shortcut}
                    className="flex cursor-default items-center gap-2.5 rounded-lg px-2 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-pending:opacity-60 [&_svg]:size-4"
                  >
                    {a.icon ? <CommandItemIcon className="text-muted-foreground">{a.icon}</CommandItemIcon> : null}
                    {a.label}
                    {a.shortcut ? <CommandShortcut className="ml-auto font-mono text-xs text-muted-foreground" /> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
