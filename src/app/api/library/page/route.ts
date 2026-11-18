import { getPageImage } from "@/lib/context/pages"
import { isValidLibraryId } from "@/lib/context/store"

/** GET ?libraryId=…&docId=…&page=N → PNG of that page (rendered by LiteParse, cached). */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams
  const libraryId = params.get("libraryId")
  const docId = params.get("docId") ?? ""
  const page = Number(params.get("page"))
  if (!isValidLibraryId(libraryId) || !/^[\w-]{1,64}$/.test(docId)) {
    return Response.json({ error: "Bad request" }, { status: 400 })
  }
  try {
    const { png } = await getPageImage(libraryId, docId, page)
    return new Response(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
    })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 })
  }
}
