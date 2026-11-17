/**
 * Same-origin proxy for Wikimedia images so they can be placed on the
 * canvas (which needs the bytes, not just a URL). Only Wikimedia's upload
 * host is allowed.
 */
const ALLOWED_HOSTS = new Set(["upload.wikimedia.org"])
const MAX_BYTES = 8 * 1024 * 1024

export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get("url")
  let url: URL
  try {
    url = new URL(target ?? "")
  } catch {
    return new Response("Bad url", { status: 400 })
  }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    return new Response("Host not allowed", { status: 403 })
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent": process.env.WIKIMEDIA_USER_AGENT || "SketchTutor/0.1 (open-source educational whiteboard app)",
    },
  })
  const type = res.headers.get("content-type") ?? ""
  if (!res.ok || !type.startsWith("image/")) {
    return new Response("Upstream error", { status: 502 })
  }
  const buf = await res.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) return new Response("Too large", { status: 413 })
  return new Response(buf, {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400" },
  })
}
