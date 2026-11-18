import { isValidOwner, listLessons } from "@/lib/lessons/store"

/** The browser's lesson history (summaries, newest first). */
export async function GET(req: Request) {
  const owner = req.headers.get("x-sketch-owner")
  if (!isValidOwner(owner)) return Response.json({ error: "Missing or invalid owner" }, { status: 400 })
  return Response.json({ lessons: await listLessons(owner) })
}
