// Smoke test for LiteParse: `node scripts/liteparse-smoke.mjs <file.pdf> [page]`
// Prints per-page markdown and renders one page screenshot.
import { LiteParse } from "@llamaindex/liteparse"

const [file, page = "1"] = process.argv.slice(2)
if (!file) {
  console.error("usage: node scripts/liteparse-smoke.mjs <file.pdf> [page]")
  process.exit(1)
}
const parser = new LiteParse({ outputFormat: "markdown", quiet: true })
const t = Date.now()
const result = await parser.parse(file)
console.log(`${file}: ${result.totalPages} pages in ${Date.now() - t} ms`)
for (const p of result.pages) {
  console.log(`--- page ${p.pageNum}${p.pageLabel ? ` (${p.pageLabel})` : ""}\n${p.markdown.slice(0, 400)}`)
}
const [shot] = await parser.screenshot(file, [Number(page)])
console.log(`screenshot page ${shot.pageNum}: ${shot.width}x${shot.height}, ${shot.imageBuffer.length} bytes`)
