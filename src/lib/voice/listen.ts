"use client"

/**
 * Voice input, on the device: Moondream's Parakeet Redux (a 1.58-bit Parakeet v3) running as
 * WebAssembly in a module Worker — fusor-rs/parakeet-redux-wasm, vendored to
 * /vendor/parakeet by scripts/vendor-parakeet.mjs. One CPU thread (no cross-origin isolation).
 * The ~199 MB model streams from Hugging Face on first use, checked part by part (BLAKE3) and
 * kept in the browser's private file storage, so later loads are local.
 *
 * Microphone audio goes from a 16 kHz AudioWorklet straight to the worker over a MessagePort;
 * every half second of new audio the engine re-transcribes and sends committed sentences (final)
 * and a provisional tail.
 */

const VENDOR = "/vendor/parakeet/"
const COMMIT = "40d4189d5abedced5134d883c9c8514273a18096"
export const MODEL_URL = `https://huggingface.co/spaces/fusorlabs/parakeet-redux-wasm/resolve/${COMMIT}/model/`
export const MODEL_MB = 199

export type ListenStatus =
  | { state: "idle" }
  | { state: "loading"; progress: number; fromCache: boolean }
  | { state: "ready"; build: string }
  | { state: "unavailable"; reason: string }

let status: ListenStatus = { state: "idle" }
const listeners = new Set<() => void>()
const setStatus = (s: ListenStatus) => {
  status = s
  listeners.forEach((l) => l())
}
export const listenStatus = {
  get: () => status,
  subscribe: (fn: () => void) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}

type Sentence = { text: string; start?: number; end?: number }
type EngineMessage =
  | { type: "runtime"; build: string; threads: number }
  | { type: "progress"; done: number; total: number; network: number; cache: number }
  | { type: "ready"; ms: number }
  | { type: "started"; job: number }
  | { type: "text" | "done"; job: number; committed?: (Sentence | string)[]; provisional?: (Sentence | string)[] }
  | { type: "warning"; message: string }
  | { type: "error" | "fatal"; job?: number; message: string }

let worker: Worker | null = null
let loading: Promise<boolean> | null = null
let build = ""
const jobHandlers = new Map<number, (m: EngineMessage) => void>()

/** The engine's runtime files are there (the vendor script ran). */
async function vendored() {
  try {
    return (await fetch(`${VENDOR}worker.js`, { method: "HEAD" })).ok
  } catch {
    return false
  }
}

/** Start the engine and load the model (downloads it the first time). Resolves false if it can't. */
export function loadParakeet(): Promise<boolean> {
  if (loading) return loading
  loading = (async () => {
    if (typeof window === "undefined" || typeof Worker === "undefined") return false
    if (!(await vendored())) {
      setStatus({ state: "unavailable", reason: "The speech-to-text engine isn't installed (run npm run dev with network once)." })
      loading = null
      return false
    }
    setStatus({ state: "loading", progress: 0, fromCache: false })
    worker = new Worker(`${VENDOR}worker.js`, { type: "module", name: "parakeet" })
    return new Promise<boolean>((resolve) => {
      worker!.onmessage = ({ data }: MessageEvent<EngineMessage>) => {
        switch (data.type) {
          case "runtime":
            build = data.build
            break
          case "progress":
            setStatus({ state: "loading", progress: data.total ? data.done / data.total : 0, fromCache: data.cache > data.network })
            break
          case "ready":
            setStatus({ state: "ready", build })
            resolve(true)
            break
          case "fatal": {
            // The engine's wasm state is gone (it traps on a panic): tell the session, start
            // over next time (the model is cached by then, so that's quick).
            jobHandlers.get(data.job ?? -1)?.(data)
            jobHandlers.clear()
            const wasReady = status.state === "ready"
            worker?.terminate()
            worker = null
            loading = null
            setStatus(wasReady ? { state: "idle" } : { state: "unavailable", reason: data.message })
            resolve(false)
            break
          }
          case "warning":
            console.warn("[parakeet]", data.message)
            break
          default:
            if ("job" in data && data.job !== undefined) jobHandlers.get(data.job)?.(data)
        }
      }
      worker!.onerror = (e) => {
        setStatus({ state: "unavailable", reason: e.message || "The speech engine failed to start." })
        loading = null
        resolve(false)
      }
      worker!.postMessage({ type: "load", modelUrl: MODEL_URL, threads: 1 })
    })
  })()
  return loading
}

const textOf = (s: Sentence | string) => (typeof s === "string" ? s : s.text)

export type Dictation = {
  /** Stop listening; resolves with the final transcript. */
  stop(): Promise<string>
  /** Throw the transcript away. */
  cancel(): void
}

let nextJob = 1

/**
 * Listen to the microphone until `stop()`. `onText(text, final)` gets the transcript so far
 * (committed sentences plus the provisional tail) as it changes; `onLevel` the loudness (0–1)
 * for a meter. Audio spoken while the model is still loading is kept and transcribed once it's in.
 */
export async function dictate({
  onText,
  onLevel,
}: {
  onText: (text: string, final: boolean) => void
  onLevel?: (level: number) => void
}): Promise<Dictation> {
  void loadParakeet()
  // Wait for the worker to exist (it does once vendored() has answered).
  for (let i = 0; i < 100 && !worker && status.state !== "unavailable"; i++) await new Promise((r) => setTimeout(r, 20))
  if (!worker) throw new Error(status.state === "unavailable" ? status.reason : "The speech engine isn't available.")
  const engine = worker

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  // The context runs at the model's rate; the browser resamples the microphone to it.
  const ctx = new AudioContext({ sampleRate: 16000 })
  await ctx.audioWorklet.addModule(`${VENDOR}capture.js`)
  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, "parakeet-capture")
  source.connect(node)
  node.connect(ctx.destination) // keeps the worklet running; its output is silence
  node.port.onmessage = ({ data }) => {
    if (data?.peaks?.length) onLevel?.(Math.min(1, Math.max(...data.peaks) * 3))
  }

  const job = nextJob++
  // Committed sentences by start time (whether updates repeat earlier ones or not), then the tail.
  const committed = new Map<string, string>()
  let provisional = ""
  const current = () => [...committed.values(), provisional].filter(Boolean).join(" ").replace(/\s+/g, " ").trim()
  let finish: ((text: string) => void) | null = null
  let failed: ((e: Error) => void) | null = null
  jobHandlers.set(job, (m) => {
    if (m.type === "text" || m.type === "done") {
      for (const s of m.committed ?? []) {
        const key = typeof s === "string" ? `${committed.size}` : `${s.start ?? committed.size}`
        committed.set(key, textOf(s).trim())
      }
      provisional = m.type === "done" ? "" : (m.provisional ?? []).map(textOf).join(" ").trim()
      onText(current(), m.type === "done")
      if (m.type === "done") {
        jobHandlers.delete(job)
        finish?.(current())
      }
    } else if (m.type === "error" || m.type === "fatal") {
      jobHandlers.delete(job)
      failed?.(new Error(m.message))
    }
  })

  const channel = new MessageChannel()
  engine.postMessage({ type: "listen", job, port: channel.port1 }, [channel.port1])
  node.port.postMessage({ type: "engine", port: channel.port2 }, [channel.port2])

  const release = () => {
    stream.getTracks().forEach((t) => t.stop())
    source.disconnect()
    node.disconnect()
    void ctx.close().catch(() => {})
    onLevel?.(0)
  }

  return {
    stop() {
      release()
      return new Promise<string>((resolve, reject) => {
        finish = resolve
        failed = reject
        engine.postMessage({ type: "stop", job })
        // If the model is still downloading, `done` comes once it has transcribed what was said.
      })
    },
    cancel() {
      release()
      jobHandlers.delete(job)
      engine.postMessage({ type: "stop", job })
    },
  }
}
