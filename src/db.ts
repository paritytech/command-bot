import type { AbstractIterator, AbstractLevelDOWN } from "abstract-leveldown"
import { isBefore, isValid, parseISO } from "date-fns"
import getLevelDb from "level-rocksdb"
import type { LevelUp } from "levelup"

import { PullRequestTask } from "./types"

export type DbKey = string
export type DbValue = string

type LevelDB = AbstractLevelDOWN<DbKey, DbValue>
type LevelIterator = AbstractIterator<DbKey, DbValue>

export type DB = LevelUp<LevelDB, LevelIterator>

export const getDb = getLevelDb as (
  path: string,
) => LevelUp<LevelDB, LevelIterator>

export const getSortedTasks = async function (
  db: DB,
  {
    match: { version, isInverseMatch },
  }: { match: { version: string; isInverseMatch?: boolean } },
) {
  type Item = {
    id: DbKey
    startDate: Date
    taskData: PullRequestTask
  }

  const items = await new Promise<Item[]>(function (resolve, reject) {
    const items: Item[] = []

    db.createReadStream()
      .on("data", function ({ key, value }) {
        try {
          const startDate = parseISO(key.toString())
          if (!isValid(startDate)) {
            throw new Error(`Invalid startDate ${key}`)
          }

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
