"use client"

import * as React from "react"

import type { EngineId } from "./engines"

/** How lessons play: paced in steps, read aloud, auto-advancing or not. Per browser. */
export type VoicePrefs = {
  /** Lessons advance one step at a time (Continue), drawings appear with their narration. */
  stepByStep: boolean
  /** Read the narration aloud. */
  narrate: boolean
  engine: EngineId
  /** Phonon voice name (default when empty). */
  voice: string
  rate: number
  /** Move to the next step by itself when narration and drawing are done. */
  autoAdvance: boolean
}

export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  stepByStep: true,
  narrate: true,
  engine: "phonon",
  voice: "",
  rate: 1,
  autoAdvance: false,
}

const KEY = "sketch-voice"
const listeners = new Set<() => void>()
let current: VoicePrefs | null = null

function read(): VoicePrefs {
  if (current) return current
  try {
    current = { ...DEFAULT_VOICE_PREFS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }
  } catch {
    current = DEFAULT_VOICE_PREFS
  }
  return current!
}

export function setVoicePrefs(patch: Partial<VoicePrefs>) {
  current = { ...read(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {}
  listeners.forEach((l) => l())
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Defaults on the server and during hydration, the saved prefs after. */
export function useVoicePrefs(): VoicePrefs {
  return React.useSyncExternalStore(subscribe, read, () => DEFAULT_VOICE_PREFS)
}
