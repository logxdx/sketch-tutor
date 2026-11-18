import { deleteLesson, getLesson, isValidOwner, renameLesson, saveLesson } from "@/lib/lessons/store"
import { isValidLessonId, type LessonPayload } from "@/lib/lessons/types"

/** Lessons carry board images and attached photos; keep one under this. */
const MAX_BYTES = 40 * 1024 * 1024

async function ids(req: Request, ctx: RouteContext<"/api/lessons/[id]">) {
  const owner = req.headers.get("x-sketch-owner")
  const { id } = await ctx.params
  if (!isValidOwner(owner) || !isValidLessonId(id)) return null
  return { owner, id }
}

const bad = () => Response.json({ error: "Missing or invalid owner / lesson id" }, { status: 400 })

export async function GET(req: Request, ctx: RouteContext<"/api/lessons/[id]">) {
  const k = await ids(req, ctx)
  if (!k) return bad()
  const lesson = await getLesson(k.owner, k.id)
  return lesson ? Response.json(lesson) : Response.json({ error: "Not found" }, { status: 404 })
}

export async function PUT(req: Request, ctx: RouteContext<"/api/lessons/[id]">) {
  const k = await ids(req, ctx)
  if (!k) return bad()
  const length = Number(req.headers.get("content-length") ?? 0)
  if (length > MAX_BYTES) return Response.json({ error: "Lesson too large to save" }, { status: 413 })
  const body = (await req.json()) as LessonPayload
  if (!Array.isArray(body?.messages)) return Response.json({ error: "messages must be an array" }, { status: 400 })
  const summary = await saveLesson(k.owner, k.id, {
    subject: typeof body.subject === "string" ? body.subject : undefined,
    mode: typeof body.mode === "string" ? body.mode : undefined,
    createdAt: typeof body.createdAt === "number" ? body.createdAt : undefined,
    messages: body.messages,
    board: body.board ?? null,
    keepTime: body.keepTime === true,
  })
  return Response.json(summary)
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/lessons/[id]">) {
  const k = await ids(req, ctx)
  if (!k) return bad()
  const { title } = (await req.json()) as { title?: unknown }
  if (typeof title !== "string") return Response.json({ error: "title must be a string" }, { status: 400 })
  const row = await renameLesson(k.owner, k.id, title)
  return row ? Response.json(row) : Response.json({ error: "Not found" }, { status: 404 })
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/lessons/[id]">) {
  const k = await ids(req, ctx)
  if (!k) return bad()
  await deleteLesson(k.owner, k.id)
  return new Response(null, { status: 204 })
}
