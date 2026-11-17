"use client"

import * as React from "react"

import type { BoardController } from "./controller"
import type { BoardStatus } from "./types"

const EMPTY: BoardStatus = {
  ready: false,
  activity: null,
  selection: [],
  steps: [],
  yourTurn: null,
  studentDirty: false,
  lastStudentActivity: 0,
  isEmpty: true,
  speed: "normal",
}

const noop = () => () => {}

/** Subscribe to the board controller's status (activity, selection, steps…). */
export function useBoardStatus(board: BoardController | null): BoardStatus {
  return React.useSyncExternalStore(
    board?.subscribe ?? noop,
    board?.getStatus ?? (() => EMPTY),
    () => EMPTY
  )
}
