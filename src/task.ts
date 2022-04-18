import { parseISO } from "date-fns"

import { Task } from "./types"
import { getNextUniqueIncrementalId } from "./utils"

export const queuedTasks: Map<
  string,
  { cancel: () => Promise<void> | void; task: Task }
> = new Map()

export const getNextTaskId = () => {
  return `${new Date().toISOString()}-${getNextUniqueIncrementalId()}`
}

export const serializeTaskQueuedDate = (date: Date) => {
  return date.toISOString()
}

export const parseTaskQueuedDate = (str: string) => {
  return parseISO(str)
}
