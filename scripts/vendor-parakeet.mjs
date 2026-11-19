// Fetches the speech-to-text engine for voice input — fusor-rs/parakeet-redux-wasm (Moondream's
// 1.58-bit Parakeet v3, compiled to WebAssembly with fusor-ai) — into public/vendor/parakeet.
// Only the single-threaded builds (~0.8 MB each, picked at runtime by relaxed-SIMD support) and
// their worker, loader and microphone worklet: no threads, no cross-origin isolation needed.
// Pinned to one commit of the project's static Space; every file is checked against its SHA-256.
// The ~199 MB model is not vendored: the browser streams it from the same pinned commit on first
// use and keeps it in its private file storage (OPFS).
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const COMMIT = "40d4189d5abedced5134d883c9c8514273a18096"
const BASE = `https://huggingface.co/spaces/fusorlabs/parakeet-redux-wasm/resolve/${COMMIT}/engine/`
const FILES = {
  "worker.js": "6cfd540759c0f73b49f988deb21edb2f2f0ee4290f7ce2033d765ebb374e0a1a",
  "capture.js": "97b4f2a33bdaca82a7ebaf4724d1ba802b3c66eb0bb29e01a151dc8263e1f624",
  "dist/host/loader.js": "e92fad5463aa477182e507cdb7ee4d2d47182b481c99bc242d57a889433b91a8",
  "dist/web-single/parakeet_runtime.js": "e1a1380bc04ca3257dee1a975eb1546a631d45ae98a70f03880c3d8355785bba",
  "dist/web-single/parakeet_runtime_bg.wasm": "0d54dec6c3a68611af9fe02d5fa5c0a71d33612503c07eb8eb804f176115ddf4",
  "dist/web-single-relaxed/parakeet_runtime.js": "e1a1380bc04ca3257dee1a975eb1546a631d45ae98a70f03880c3d8355785bba",
  "dist/web-single-relaxed/parakeet_runtime_bg.wasm": "cc10cb9e94d378ce768265740ba4995b1aec5b8368bfc1ada45cc36754027394",
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const dest = join(root, "public", "vendor", "parakeet")
const stamp = join(dest, ".commit")
if (existsSync(stamp) && readFileSync(stamp, "utf8") === COMMIT) process.exit(0)

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex")
try {
  const got = {}
  for (const [file, hash] of Object.entries(FILES)) {
    const res = await fetch(BASE + file)
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (sha256(buf) !== hash) throw new Error(`${file}: SHA-256 mismatch`)
    got[file] = buf
  }
  rmSync(dest, { recursive: true, force: true })
  for (const [file, buf] of Object.entries(got)) {
    mkdirSync(dirname(join(dest, file)), { recursive: true })
    writeFileSync(join(dest, file), buf)
  }
  writeFileSync(
    join(dest, "LICENSE"),
    `parakeet-redux-wasm — https://github.com/fusor-rs/parakeet-redux-wasm (Space commit ${COMMIT})

MIT License

Copyright (c) 2026 Fusor

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The model it loads — Moondream's Parakeet Redux (https://huggingface.co/moondream/parakeet-redux),
based on NVIDIA's parakeet-tdt-0.6b-v3 — is licensed under CC BY 4.0.
`
  )
  writeFileSync(stamp, COMMIT)
  console.log(`[parakeet] speech-to-text engine (${COMMIT.slice(0, 7)}) → public/vendor/parakeet`)
} catch (e) {
  // Offline or the Space moved: the app still runs, voice input says it's unavailable.
  console.log(`[parakeet] couldn't fetch the speech-to-text engine (${e.message}); voice input is off.`)
}
