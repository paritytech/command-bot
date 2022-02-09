import type { AbstractIterator, AbstractLevelDOWN } from "abstract-leveldown"
import { isBefore } from "date-fns"
// @ts-ignore because level-rocksdb is not typed
import getLevelDb from "level-rocksdb"
import type { LevelUp } from "levelup"

import { State, Task } from "./types"

type DbKey = string
type DbValue = string
type LevelDB = AbstractLevelDOWN<DbKey, DbValue>
type LevelIterator = AbstractIterator<DbKey, DbValue>
type DB = LevelUp<LevelDB, LevelIterator>

export const getDb = getLevelDb as (
  path: string,
) => LevelUp<LevelDB, LevelIterator>

export class TaskDB {
  constructor(public db: DB) {}
}

export class AccessDB {
  constructor(public db: DB) {}
}

export class KeyAlreadyExists {}

export const getSortedTasks = async function (
  { taskDb: { db }, parseTaskId }: Pick<State, "parseTaskId" | "taskDb">,
  {
    match: { version, isInverseMatch },
  }: {
    match: { version: string; isInverseMatch?: boolean }
  },
) {
  type Item = {
    id: DbKey
    startDate: Date
    taskData: Task
  }

  const items = await new Promise<Item[]>(function (resolve, reject) {
    const items: Item[] = []

    db.createReadStream()
      .on("data", function ({ key, value }) {
        try {
          const parsedId = parseTaskId(key)
          if (parsedId instanceof Error) {
            throw parsedId
          }

          const { date: startDate } = parsedId
          const taskData = JSON.parse(value.toString())
          if (
            (taskData.version === version && !isInverseMatch) ||
            (taskData.version !== version && isInverseMatch)
          ) {
            items.push({ id: key, startDate, taskData })
          }
        } catch (error) {
          reject(error)
        }
      })
      .on("error", function (error) {
        reject(error)
      })
      .on("end", function () {
        resolve(items)
      })
  })

  items.sort(function ({ startDate: dateA }, { startDate: dateB }) {
    if (isBefore(dateA, dateB)) {
      return -1
    } else if (isBefore(dateB, dateA)) {
      return 1
    }
    return 0
  })

  return items
}
