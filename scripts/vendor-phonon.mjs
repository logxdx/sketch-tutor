// Copies the phonon-tts browser package (on-device TTS: Phonon 31m compiled to WebAssembly)
// into public/vendor/phonon-tts so the page loads it — its worker and wasm files — from the
// app's own origin, untouched by the bundler. Runs before `dev` and `build`; without the
// package installed it does nothing and narration uses the browser's built-in voice.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const src = join(root, "node_modules", "phonon-tts")
const dest = join(root, "public", "vendor", "phonon-tts")

if (!existsSync(join(src, "package.json"))) {
  console.log("[phonon] phonon-tts not installed — narration will use the browser voice (npm install phonon-tts to enable).")
  process.exit(0)
}
const { version } = JSON.parse(readFileSync(join(src, "package.json"), "utf8"))
const stamp = join(dest, ".version")
if (existsSync(stamp) && readFileSync(stamp, "utf8") === version) process.exit(0)

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
// Only what the browser loads: the ES modules and the single-threaded wasm builds (the app runs
// Phonon on one thread). No threaded builds, type declarations, docs or tests.
const skip = (p) =>
  p.startsWith(join(src, "node_modules")) ||
  // wasm-threads/ is only import()ed when threads > 1.
  /[\\/](test|tests|www|examples|wasm-threads)([\\/]|$)/.test(p.slice(src.length)) ||
  /\.(d\.ts|map)$/i.test(p) ||
  /README\.md$/i.test(p) // licences (incl. THIRD_PARTY_LICENSES.md for the compiled crates) stay
cpSync(src, dest, { recursive: true, filter: (p) => !skip(p) })
writeFileSync(stamp, version)
console.log(`[phonon] phonon-tts ${version} → public/vendor/phonon-tts`)
