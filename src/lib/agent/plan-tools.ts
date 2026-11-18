import { tool } from "ai"

import { applyPlanUpdate, buildPlan, planLessonInput, planProgress, planUpdateInput, type LessonPlan } from "./plan"

type PlanResult = { ok: true; plan: LessonPlan; next: string | null; note: string } | { ok: false; error: string }

/**
 * Route tools. They run on the server (instant, no browser round trip) and
 * return the whole route; the browser redraws the map on the board from it.
 * State is shared across the steps of one request so a plan_lesson followed by
 * plan_update in the same turn sees the new route.
 */
export function createPlanTools(initial: LessonPlan | null) {
  let plan = initial
  return {
    plan_lesson: tool({
      description:
        "Lay out the learning route as a dependency map from what the student already understands to their goal, drawn on the board as a map they can follow. Use after measuring what they know (probe questions), for anything that takes several steps to understand. 4-9 steps is typical; mark steps they showed they already understand as known. Calling it again replaces the route (keep statuses that still hold).",
      inputSchema: planLessonInput,
      execute: async (input): Promise<PlanResult> => {
        const r = buildPlan(input)
        if ("error" in r) return { ok: false, error: r.error }
        plan = r.plan
        return {
          ok: true,
          plan,
          next: plan.current,
          note: "The route map is now on the board. Tell the student the route in a sentence, then teach the current step.",
        }
      },
    }),
    plan_update: tool({
      description:
        "Move through the route: mark steps the student has now shown they understand (done), ones they turned out to know (known), reopen a step when a misconception surfaces, and set the step you're teaching now (current). The map on the board updates.",
      inputSchema: planUpdateInput,
      execute: async (input): Promise<PlanResult> => {
        if (!plan) return { ok: false, error: "There is no route yet — call plan_lesson first." }
        const r = applyPlanUpdate(plan, input)
        if ("error" in r) return { ok: false, error: r.error }
        plan = r.plan
        const { finished } = planProgress(plan)
        return {
          ok: true,
          plan,
          next: plan.current,
          note: finished
            ? "Every step is understood — the goal is reached. Recap the whole route in a few sentences and check the goal itself."
            : `Now teaching: ${plan.nodes.find((n) => n.id === plan!.current)?.title ?? "—"}.`,
        }
      },
    }),
  }
}

export type PlanTools = ReturnType<typeof createPlanTools>
