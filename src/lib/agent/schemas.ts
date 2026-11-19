import { z } from "zod"

/**
 * Input schemas shared by the server (tool definitions sent to the model) and
 * the browser (typed tool parts, rendering). No server-only imports here.
 */

export const COLORS = ["black", "blue", "red", "green", "orange", "purple", "teal", "gray"] as const
export const color = z.enum(COLORS).optional().describe("Ink color; use it with consistent meaning.")

const point = z.object({ x: z.number(), y: z.number() })

export const shapeSchema = z.object({
  id: z
    .string()
    .optional()
    .describe('Short id you choose (e.g. "nucleus"). Needed if an arrow connects to it or you refer to it later.'),
  kind: z.enum(["rect", "ellipse", "diamond", "text", "arrow", "line"]),
  x: z.number().optional().describe("Left edge in PANEL coordinates (panel ≈ 800 wide × 600 tall)."),
  y: z.number().optional().describe("Top edge in PANEL coordinates."),
  w: z.number().optional().describe("Width (shapes) or max text width."),
  h: z.number().optional().describe("Height (shapes)."),
  text: z
    .string()
    .optional()
    .describe("text: the words. rect/ellipse/diamond: label inside. arrow: label on it. Short; \\n for new lines."),
  from: z.string().optional().describe("arrow/line: id of the shape it starts at (new or already on the board)."),
  to: z.string().optional().describe("arrow/line: id of the shape it ends at (new or already on the board)."),
  points: z
    .array(point)
    .optional()
    .describe("arrow/line without from/to: 2+ points in PANEL coordinates."),
  color,
  fill: z.boolean().optional().describe("Soft fill for shapes."),
  size: z.enum(["s", "m", "l", "xl"]).optional().describe("Text size; m default, l/xl for titles."),
  dashed: z.boolean().optional(),
})

// ---------------------------------------------------------------- board

export const drawInput = z.object({
  title: z.string().describe("Short title for this step, shown in the lesson outline."),
  shapes: z.array(shapeSchema).min(1).max(40),
  placement: z.enum(["below", "right"]).optional().describe("Where relative to existing content. Default below."),
  near: z.string().optional().describe("Id of a board element to place this panel next to."),
})

// ------------------------------------------------- board components

/**
 * Ready-made board components: the tutor gives the content, the board lays it out (measured
 * text, no overlaps), so structured visuals need no coordinates — like a UI component catalog.
 */
const label = z.string().describe("Short; wraps automatically.")
export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: label }),
  z.object({ type: z.literal("text"), text: z.string().describe("A sentence or two."), color }),
  z.object({ type: z.literal("bullets"), items: z.array(label).min(1).max(8), color }),
  z.object({
    type: z.literal("steps"),
    items: z.array(label).min(2).max(8).describe("A process in order, drawn as boxes joined by arrows."),
    direction: z.enum(["right", "down"]).optional(),
    color,
  }),
  z.object({
    type: z.literal("flow"),
    nodes: z.array(z.object({ id: z.string(), label, color })).min(2).max(12),
    edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() })).max(20),
    direction: z.enum(["right", "down"]).optional(),
  }).describe("A flowchart / concept map: laid out in layers from the edges."),
  z.object({
    type: z.literal("cycle"),
    items: z.array(label).min(3).max(8).describe("Stages that loop back to the start."),
    center: z.string().optional().describe("Label in the middle."),
    color,
  }),
  z.object({
    type: z.literal("compare"),
    columns: z.array(z.object({ title: label, items: z.array(label).max(8), color })).min(2).max(4),
  }).describe("Side-by-side columns: pros/cons, before/after, A vs B."),
  z.object({
    type: z.literal("table"),
    headers: z.array(z.string()).min(1).max(6),
    rows: z.array(z.array(z.string())).min(1).max(10),
  }),
  z.object({
    type: z.literal("timeline"),
    events: z.array(z.object({ when: z.string(), label })).min(2).max(10),
  }),
  z.object({
    type: z.literal("equation"),
    lines: z
      .array(z.object({ math: z.string().describe("Plain Unicode maths, e.g. 2x + 3 = 11."), note: z.string().optional() }))
      .min(1)
      .max(8),
  }).describe("Worked steps of a calculation, one per line, with optional notes."),
  z.object({
    type: z.literal("callout"),
    text: z.string(),
    tone: z.enum(["key", "tip", "warning"]).optional(),
  }).describe("A boxed key idea, tip or common mistake."),
  z.object({
    type: z.literal("tree"),
    root: label,
    children: z.array(z.object({ label, children: z.array(label).max(6).optional() })).min(1).max(6),
  }).describe("A hierarchy / classification (two levels)."),
  z.object({
    type: z.literal("number_line"),
    min: z.number(),
    max: z.number(),
    step: z.number().optional(),
    marks: z.array(z.object({ at: z.number(), label: z.string().optional(), color })).max(10).optional(),
  }),
])

export const composeInput = z.object({
  title: z.string().describe("Short title for this step, shown in the lesson outline."),
  blocks: z.array(blockSchema).min(1).max(6).describe("Stacked top to bottom."),
  width: z.number().optional().describe("Panel width in px (default 640)."),
  placement: z.enum(["below", "right"]).optional(),
  near: z.string().optional().describe("Id of a board element to place this panel next to."),
})

export const plotInput = z.object({
  title: z.string().optional(),
  functions: z
    .array(
      z.object({
        expr: z.string().describe('Expression in x (math.js), e.g. "2*x^2 - 5*x + 3", "sin(x)".'),
        label: z.string().optional(),
        color,
      })
    )
    .min(1)
    .max(4),
  xMin: z.number(),
  xMax: z.number(),
  yMin: z.number().optional(),
  yMax: z.number().optional(),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
  points: z.array(z.object({ x: z.number(), y: z.number(), label: z.string().optional() })).max(8).optional(),
  near: z.string().optional(),
})

export const annotateInput = z.object({
  targets: z.array(z.string()).min(1).describe("Ids of board elements to mark."),
  style: z.enum(["circle", "underline", "check", "cross", "highlight", "arrow"]),
  note: z.string().optional().describe("Short note written next to the mark."),
  color,
})

export const pointAtInput = z.object({
  targets: z.array(z.string()).min(1),
  caption: z.string().optional().describe("A few words shown beside your cursor."),
})

export const eraseInput = z.object({
  ids: z.array(z.string()).optional(),
  all: z.boolean().optional(),
})

export const askStudentInput = z.object({
  task: z.string().describe("What the student should draw or write, in one sentence."),
  width: z.number().optional(),
  height: z.number().optional(),
  near: z.string().optional(),
})

export const quizInput = z.object({
  question: z.string(),
  kind: z
    .enum(["choice", "recall"])
    .optional()
    .describe("choice (default) = multiple choice; recall = the student writes the answer in their own words."),
  options: z
    .array(z.string())
    .min(2)
    .max(6)
    .optional()
    .describe("choice: the options (shown shuffled). Make wrong options real misconceptions, not jokes."),
  correctIndex: z.number().int().optional().describe("choice: 0-based index of the correct option."),
  answer: z
    .string()
    .optional()
    .describe("recall: the answer you commit to BEFORE seeing theirs (shown to them after they answer; you judge theirs against it)."),
  explanation: z.string().describe("Why the right answer is right (shown after answering)."),
  purpose: z
    .enum(["probe", "check"])
    .optional()
    .describe("probe = measuring what they already know before teaching; check = testing what you just taught (default)."),
  step: z.string().optional().describe("Id of the route step this question is about, if there is a route."),
})

/** What the student sends back from a question card. */
export type QuizAnswer = {
  kind: "choice" | "recall"
  /** "I don't know yet" — they skipped rather than guess. */
  skipped?: boolean
  chosenIndex?: number
  chosen?: string
  correct?: boolean
  answer?: string
  confidence?: "guessing" | "fairly sure" | "certain"
  reasoning?: string
}

// ---------------------------------------------------------- rich media

const vec3 = z.array(z.number()).length(3).describe("[x, y, z]; y is up.")

export const scene3dObject = z.object({
  kind: z.enum([
    "sphere",
    "box",
    "cylinder",
    "cone",
    "torus",
    "plane",
    "vector",
    "line",
    "point",
    "label",
    "surface",
    "curve",
  ]),
  position: vec3.optional(),
  rotation: vec3.optional().describe("Degrees about x, y, z."),
  size: z.number().optional().describe("Radius (sphere/cylinder/cone/torus/point) or edge length (box/plane)."),
  dims: vec3.optional().describe("box: width,height,depth; cylinder/cone: radius,height,0."),
  color: z.string().optional().describe("CSS color, e.g. '#1971c2' or 'tomato'."),
  opacity: z.number().optional(),
  wireframe: z.boolean().optional(),
  label: z.string().optional().describe("Text label floating next to the object."),
  from: vec3.optional().describe("vector/line start."),
  to: vec3.optional().describe("vector/line end."),
  points: z.array(vec3).optional().describe("line: polyline points."),
  expr: z
    .string()
    .optional()
    .describe(
      'surface: height y = f(x, z) e.g. "sin(x)*cos(z)". curve: parametric "[cos(t), t/4, sin(t)]" in t.'
    ),
  range: z
    .object({ min: z.number(), max: z.number() })
    .optional()
    .describe("surface: x and z range; curve: t range."),
  spin: z.number().optional().describe("Self rotation speed (radians/s about y)."),
  orbit: z
    .object({ center: vec3, radius: z.number(), speed: z.number() })
    .optional()
    .describe("Orbit around a point in the horizontal plane (radians/s)."),
})

export const show3dInput = z.object({
  title: z.string(),
  caption: z.string().optional().describe("One-line explanation of what to notice."),
  objects: z.array(scene3dObject).min(1).max(80),
  showAxes: z.boolean().optional(),
  showGrid: z.boolean().optional(),
  camera: vec3.optional().describe("Camera position; it looks at the origin."),
  autoRotate: z.boolean().optional(),
})

export const chartInput = z.object({
  title: z.string(),
  kind: z.enum(["bar", "stacked-bar", "line", "area", "scatter"]),
  data: z
    .array(z.record(z.string(), z.union([z.string(), z.number()])))
    .min(1)
    .max(200)
    .describe("Rows, e.g. [{year: 1990, gdp: 5.9}, ...]."),
  xKey: z.string().describe("Field used for the x axis / categories."),
  series: z
    .array(z.object({ key: z.string(), label: z.string().optional() }))
    .min(1)
    .max(6)
    .describe("Numeric fields to plot (≤3 for scatter)."),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
  caption: z.string().optional(),
  source: z.string().optional().describe("Where the numbers come from (cite your research)."),
})

export const exploreInput = z.object({
  title: z.string(),
  expr: z.string().describe('y as a function of x and parameters, e.g. "a*sin(b*x + c)".'),
  params: z
    .array(
      z.object({
        name: z.string(),
        min: z.number(),
        max: z.number(),
        step: z.number().optional(),
        value: z.number(),
        label: z.string().optional(),
      })
    )
    .min(1)
    .max(5),
  xMin: z.number(),
  xMax: z.number(),
  yMin: z.number().optional(),
  yMax: z.number().optional(),
  caption: z.string().optional().describe("What to try: \"Drag b and watch the period change\"."),
})

export const suggestRepliesInput = z.object({
  options: z.array(z.string()).min(2).max(4),
})
