import type { AbstractIterator, AbstractLevelDOWN } from "abstract-leveldown";
import { isBefore, isValid } from "date-fns";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore because level-rocksdb is not typed
import getLevelDb from "level-rocksdb";
import type { LevelUp } from "levelup";

import { parseTaskQueuedDate, queuedTasks, Task } from "./task";
import { Context, ToString } from "./types";

type DbKey = string;
type DbValue = string;
type LevelDB = AbstractLevelDOWN<DbKey, DbValue>;
type LevelIterator = AbstractIterator<DbKey, DbValue>;
type DB = LevelUp<LevelDB, LevelIterator>;

export const getDb = getLevelDb as (path: string) => LevelUp<LevelDB, LevelIterator>;

export class TaskDB {
  constructor(public db: DB) {}
}

export class AccessDB {
  constructor(public db: DB) {}
}

type Item = {
  id: DbKey;
  queuedDate: Date;
  task: Task;
};

export const getSortedTasks = async (
  { taskDb: { db }, logger }: Pick<Context, "taskDb" | "logger">,
  {
    onlyNotAlive,
  }: {
    onlyNotAlive?: boolean;
  } = {},
): Promise<Item[]> => {
  const items = await new Promise<Item[]>((resolve, reject) => {
    const databaseItems: Item[] = [];

    db.createReadStream()
      .on("data", ({ key: rawKey, value: rawValue }: { key: ToString; value: ToString }) => {
        try {
          const key = rawKey.toString();
          const value = rawValue.toString();

          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const task: Task = JSON.parse(value);
          if (!onlyNotAlive || !queuedTasks.has(task.id)) {
            const queuedDate = parseTaskQueuedDate(task.queuedDate);
            if (isValid(queuedDate)) {
              databaseItems.push({ id: key, queuedDate, task });
            } else {
              logger.error({ key, value }, "Found key with invalid date in the database");
              void db.del(key);
            }
          }
        } catch (error) {
          reject(error);
        }
      })
      .on("error", (error) => {
        reject(error);
      })
      .on("end", () => {
        resolve(databaseItems);
      });
  });

  items.sort(({ queuedDate: dateA, task: taskA }, { queuedDate: dateB, task: taskB }) => {
    if (isBefore(dateA, dateB)) {
      return -1;
    } else if (isBefore(dateB, dateA)) {
      return 1;
    } else if (taskA.id < taskB.id) {
      return -1;
    } else if (taskB.id < taskA.id) {
      return 1;
    }
    return 0;
  });

  return items;
};
