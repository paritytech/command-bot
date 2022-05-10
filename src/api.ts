import bodyParser from "body-parser"
import { randomUUID } from "crypto"
import { NextFunction, RequestHandler, Response } from "express"
import Joi from "joi"
import LevelErrors from "level-errors"
import path from "path"
import { Server } from "probot"

import {
  ApiTask,
  cancelTask,
  getNextTaskId,
  getSendTaskMatrixResult,
  queueTask,
  serializeTaskQueuedDate,
} from "./task"
import { Context } from "./types"

const getApiRoute = (route: string) => {
  return `/api${route}`
}

const taskRoute = "/task/:task_id"

export const getApiTaskEndpoint = (task: ApiTask) => {
  return getApiRoute(taskRoute).replaceAll(":task_id", task.id)
}

const response = <T>(
  res: Response,
  next: NextFunction,
  code: number,
  body?: T,
) => {
  if (body === undefined) {
    res.status(code).send()
  } else {
    res.status(code).json(body)
  }
  next()
}

const errorResponse = <T>(
  res: Response,
  next: NextFunction,
  code: number,
  body?: T,
) => {
  response(res, next, code, body === undefined ? undefined : { error: body })
}

const jsonBodyParserMiddleware = bodyParser.json()

export const setupApi = (ctx: Context, server: Server) => {
  const { accessDb, matrix, repositoryCloneDirectory, logger } = ctx

  const apiError = (res: Response, next: NextFunction, error: unknown) => {
    const msg = "Failed to handle errors in API endpoint"
    logger.fatal(error, msg)
    errorResponse(res, next, 500, msg)
  }

  type JsonRequestHandlerParams = Parameters<
    RequestHandler<Record<string, unknown>, unknown, Record<string, unknown>>
  >
  const setupRoute = <T extends "post" | "get" | "delete" | "patch">(
    method: T,
    routePath: string,
    handler: (args: {
      req: JsonRequestHandlerParams[0]
      res: JsonRequestHandlerParams[1]
      next: JsonRequestHandlerParams[2]
      token: string
      matrixRoom: string
    }) => void | Promise<void>,
    { checkMasterToken }: { checkMasterToken?: boolean } = {},
  ) => {
    server.expressApp[method](
      getApiRoute(routePath),
      jsonBodyParserMiddleware,
      async (req, res, next) => {
        try {
          const token = req.headers["x-auth"]
          if (typeof token !== "string" || !token) {
            return errorResponse(res, next, 400, "Invalid auth token")
          }

          /*
            Empty when the masterToken is supposed to be used because it doesn't
            matter in that case
          */
          let matrixRoom: string = ""
          if (checkMasterToken) {
            if (token !== ctx.masterToken) {
              return errorResponse(
                res,
                next,
                422,
                `Invalid ${token} for master token`,
              )
            }
          } else {
            try {
              matrixRoom = await accessDb.db.get(token)
            } catch (error) {
              if (error instanceof LevelErrors.NotFoundError) {
                return errorResponse(res, next, 404, "Token not found")
              } else {
                return apiError(res, next, error)
              }
            }
          }

          await handler({ req, res, next, token, matrixRoom })
        } catch (error) {
          apiError(res, next, error)
        }
      },
    )
  }

  setupRoute("post", "/queue", async ({ req, res, next, matrixRoom }) => {
    if (matrix === null) {
      return errorResponse(
        res,
        next,
        400,
        "Matrix is not configured for this server",
      )
    }

    const validation = Joi.object()
      .keys({
        command: Joi.string().required(),
        job: Joi.object().keys({
          tags: Joi.array().items(Joi.string()).required(),
          image: Joi.string().required(),
        }),
        gitRef: Joi.object().keys({
          contributor: Joi.string().required(),
          owner: Joi.string().required(),
          repo: Joi.string().required(),
          branch: Joi.string().required(),
        }),
      })
      .validate(req.body)
    if (validation.error) {
      return errorResponse(res, next, 422, validation.error)
    }

    type Payload = Pick<ApiTask, "gitRef" | "command"> & {
      job: ApiTask["gitlab"]["job"]
    }
    const { command, job, gitRef } = req.body as Payload

    const taskId = getNextTaskId()
    const queuedDate = new Date()

    const task: ApiTask = {
      id: taskId,
      tag: "ApiTask",
      timesRequeued: 0,
      timesRequeuedSnapshotBeforeExecution: 0,
      timesExecuted: 0,
      gitRef,
      matrixRoom,
      repoPath: path.join(repositoryCloneDirectory, gitRef.repo),
      queuedDate: serializeTaskQueuedDate(queuedDate),
      requester: matrixRoom,
      command,
      gitlab: { job, pipeline: null },
    }

    const updateProgress = getSendTaskMatrixResult(matrix, logger, task)
    const queueMessage = await queueTask(ctx, task, {
      onResult: updateProgress,
      updateProgress,
    })

    response(res, next, 201, { task, queueMessage })
  })

  setupRoute("delete", taskRoute, async ({ req, res, next }) => {
    const { task_id: taskId } = req.params
    if (typeof taskId !== "string" || !taskId) {
      return errorResponse(res, next, 403, "Invalid task_id")
    }

    const cancelError = await cancelTask(ctx, taskId)
    if (cancelError instanceof LevelErrors.NotFoundError) {
      return errorResponse(res, next, 404, "Task not found")
    }

    response(res, next, 204)
  })

  setupRoute(
    "post",
    "/access",
    async ({ req, res, next }) => {
      const { matrixRoom } = req.body
      if (typeof matrixRoom !== "string" || !matrixRoom) {
        return errorResponse(res, next, 400, "Invalid matrixRoom")
      }

      const requesterToken = randomUUID()
      try {
        if (await accessDb.db.get(requesterToken)) {
          return errorResponse(res, next, 422, "requesterToken already exists")
        }
      } catch (error) {
        if (!(error instanceof LevelErrors.NotFoundError)) {
          return apiError(res, next, error)
        }
      }

      await accessDb.db.put(requesterToken, matrixRoom)
      response(res, next, 201, { token: requesterToken })
    },
    { checkMasterToken: true },
  )

  setupRoute("patch", "/access", async ({ req, res, next, token }) => {
    const { matrixRoom } = req.body
    if (typeof matrixRoom !== "string" || !matrixRoom) {
      return errorResponse(res, next, 400, "Invalid matrixRoom")
    }

    try {
      const value = await accessDb.db.get(token)
      if (!value) {
        return errorResponse(res, next, 404)
      }
    } catch (error) {
      if (error instanceof LevelErrors.NotFoundError) {
        return errorResponse(res, next, 404)
      } else {
        return apiError(res, next, error)
      }
    }

    await accessDb.db.put(token, matrixRoom)
    response(res, next, 204)
  })

  setupRoute("delete", "/access", async ({ res, next, token }) => {
    try {
      const value = await accessDb.db.get(token)
      if (!value) {
        return errorResponse(res, next, 404)
      }
    } catch (error) {
      if (error instanceof LevelErrors.NotFoundError) {
        return errorResponse(res, next, 404)
      } else {
        return apiError(res, next, error)
      }
    }

    await accessDb.db.put(token, "")
    response(res, next, 204)
  })
}
