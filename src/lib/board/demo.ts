import type { BoardController } from "./controller"

/**
 * A scripted mini-lesson that drives the board through the same tool
 * executor the agent uses — handy for trying the whiteboard without an API
 * key, and as a smoke test of every board tool. Stops when the student
 * presses Stop.
 */
export async function playDemo(board: BoardController, say: (text: string) => void) {
  const epoch = board.currentEpoch()
  const steps: [string | null, () => Promise<unknown>][] = [
    [
      "The water cycle — watch the board.",
      () =>
        board.draw(
          {
            title: "The water cycle",
            shapes: [
              { kind: "text", x: 0, y: 0, text: "The water cycle", size: "xl", color: "blue" },
              { id: "ocean", kind: "rect", x: 0, y: 260, w: 220, h: 80, text: "Ocean", color: "blue", fill: true },
              { id: "cloud", kind: "ellipse", x: 300, y: 70, w: 200, h: 90, text: "Cloud", color: "gray", fill: true },
              { id: "mountain", kind: "diamond", x: 560, y: 230, w: 170, h: 120, text: "Land", color: "green", fill: true },
              { kind: "arrow", from: "ocean", to: "cloud", text: "evaporation", color: "orange" },
              { kind: "arrow", from: "cloud", to: "mountain", text: "precipitation", color: "blue" },
              { kind: "arrow", from: "mountain", to: "ocean", text: "runoff", color: "teal" },
            ],
          },
          "demo-cycle"
        ),
    ],
    ["The Sun's energy drives evaporation:", () => board.pointAt({ targets: ["ocean"], caption: "heat → vapour" })],
    [
      "Evaporation rises with temperature — roughly exponentially:",
      () =>
        board.plot(
          {
            title: "Saturation vapour pressure",
            functions: [{ expr: "0.611 * exp(17.27*x/(x+237.3))", label: "kPa", color: "orange" }],
            xMin: 0,
            xMax: 40,
            xLabel: "°C",
            yLabel: "kPa",
            points: [{ x: 25, y: 3.17, label: "25 °C ≈ 3.2 kPa" }],
          },
          "demo-plot"
        ),
    ],
    [null, () => board.annotate({ targets: ["cloud"], style: "check", note: "condensation happens here" }, "demo-note")],
    [
      "Your turn — add where groundwater fits in.",
      () => board.askStudent({ task: "Draw where groundwater fits into the cycle.", near: "mountain" }, "demo-task"),
    ],
  ]
  for (const [line, run] of steps) {
    if (board.currentEpoch() !== epoch) return
    if (line) say(line)
    await run()
  }
}
