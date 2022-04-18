import type { AbstractIterator, AbstractLevelDOWN } from "abstract-leveldown"
import { isBefore, isValid, parseISO } from "date-fns"
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore because level-rocksdb is not typed
import getLevelDb from "level-rocksdb"
import type { LevelUp } from "levelup"

import { Context, Task, ToString } from "./types"

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

export const getSortedTasks = async (
  {
    taskDb: { db },
    serverInfo,
    logger,
  }: Pick<Context, "taskDb" | "startDate" | "serverInfo" | "logger">,
  {
    fromOtherServerInstances,
  }: {
    fromOtherServerInstances?: boolean
  } = {},
) => {
  type Item = {
    id: DbKey
    queuedDate: Date
    taskData: Task
  }

  const items = await new Promise<Item[]>((resolve, reject) => {
    const databaseItems: Item[] = []

    db.createReadStream()
      .on(
        "data",
        ({
          key: rawKey,
          value: rawValue,
        }: {
          key: ToString
          value: ToString
        }) => {
          try {
            const key = rawKey.toString()
            const value = rawValue.toString()

            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const taskData: Task = JSON.parse(value)
            if (
              (taskData.serverId === serverInfo.id &&
                !fromOtherServerInstances) ||
              (taskData.serverId !== serverInfo.id && fromOtherServerInstances)
            ) {
              const queuedDate = parseISO(taskData.queuedDate)
              if (isValid(queuedDate)) {
                databaseItems.push({ id: key, queuedDate, taskData })
              } else {
                logger.error(
                  { key, value },
                  "Found key with invalid date in the database",
                )
                void db.del(key)
              }
            }
          } catch (error) {
            reject(error)
          }
        },
      )
      .on("error", (error) => {
        reject(error)
      })
      .on("end", () => {
        resolve(databaseItems)
      })
  })

  items.sort(({ queuedDate: dateA }, { queuedDate: dateB }) => {
    if (isBefore(dateA, dateB)) {
      return -1
    } else if (isBefore(dateB, dateA)) {
      return 1
    }
    return 0
  })

  return items
}
