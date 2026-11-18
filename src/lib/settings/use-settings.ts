"use client"

import * as React from "react"

import {
  DEFAULT_SETTINGS,
  parseSettings,
  type ModelInfo,
  type ProviderId,
  type SettingsInfo,
  type TutorSettings,
} from "@/lib/agent/settings"

const STORAGE_KEY = "sketch-settings"
const RECENT_KEY = "sketch-recent-models"

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

function load(): TutorSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? parseSettings(JSON.parse(raw)) : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

function merge<T>(base: T, patch: DeepPartial<T>): T {
  const out = { ...base } as Record<string, unknown>
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const cur = out[k]
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object"
        ? merge(cur, v as DeepPartial<typeof cur>)
        : v
  }
  return out as T
}

/** Settings (persisted per browser), provider status from the server, and model catalogs. */
export function useSettings() {
  const [settings, setSettings] = React.useState<TutorSettings>(() =>
    typeof window === "undefined" ? DEFAULT_SETTINGS : load()
  )
  const [info, setInfo] = React.useState<SettingsInfo | null>(null)
  const [catalogs, setCatalogs] = React.useState<Partial<Record<ProviderId, { models: ModelInfo[]; error?: string; loading: boolean }>>>({})
  const [recent, setRecent] = React.useState<string[]>(() => {
    try {
      return typeof window === "undefined" ? [] : (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[])
    } catch {
      return []
    }
  })

  React.useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => {})
  }, [])

  const update = React.useCallback((patch: DeepPartial<TutorSettings>) => {
    setSettings((cur) => {
      const next = parseSettings(merge(cur, patch))
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {}
      return next
    })
  }, [])

  const reset = React.useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {}
  }, [])

  /** The provider requests will actually use (falls back to the server's if the choice isn't configured). */
  const provider: ProviderId =
    settings.provider && info?.providers.find((p) => p.id === settings.provider)?.configured
      ? settings.provider
      : (info?.active ?? "groq")
  const status = info?.providers.find((p) => p.id === provider)
  const defaults = status?.defaults ?? { tutor: "", vision: "", research: "" }
  const tutorModel = settings.models.tutor || defaults.tutor

  const loadCatalog = React.useCallback(async (id: ProviderId) => {
    setCatalogs((c) => (c[id]?.models.length ? c : { ...c, [id]: { models: [], loading: true } }))
    try {
      const res = await fetch(`/api/models?provider=${id}`)
      const data = (await res.json()) as { models: ModelInfo[]; error?: string }
      setCatalogs((c) => ({ ...c, [id]: { models: data.models, error: data.error, loading: false } }))
    } catch (e) {
      setCatalogs((c) => ({ ...c, [id]: { models: [], error: (e as Error).message, loading: false } }))
    }
  }, [])

  /** Pick a tutor model (optionally switching provider) and remember it in the recents list. */
  const chooseModel = React.useCallback(
    (id: string, on: ProviderId = provider) => {
      update({ provider: on, models: { tutor: id } })
      setRecent((cur) => {
        const next = [`${on}:${id}`, ...cur.filter((x) => x !== `${on}:${id}`)].slice(0, 6)
        try {
          localStorage.setItem(RECENT_KEY, JSON.stringify(next))
        } catch {}
        return next
      })
    },
    [provider, update]
  )

  const catalog = catalogs[provider]
  const modelInfo = (id: string, on: ProviderId = provider) => catalogs[on]?.models.find((m) => m.id === id)

  return {
    settings,
    update,
    reset,
    info,
    provider,
    defaults,
    tutorModel,
    catalog,
    catalogs,
    loadCatalog,
    modelInfo,
    chooseModel,
    recent: recent.map((r) => {
      const i = r.indexOf(":")
      return { provider: r.slice(0, i) as ProviderId, id: r.slice(i + 1) }
    }),
  }
}

export type SettingsApi = ReturnType<typeof useSettings>
