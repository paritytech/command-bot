import Ajv from "ajv"
import bodyParser from "body-parser"
import { NextFunction, RequestHandler, Response } from "express"
import LevelErrors from "level-errors"
import path from "path"
import { Server } from "probot"

import { parseTryRuntimeBotCommandArgs } from "./core"
import {
  ApiTask,
  getNextTaskId,
  getSendTaskMatrixResult,
  queuedTasks,
  queueTask,
  serializeTaskQueuedDate,
} from "./task"
import { Context } from "./types"
import { displayCommand } from "./utils"

const getApiRoute = (route: string) => {
  return `/api${route}`
}

const taskRoute = "/task/:task_id"

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

          if (checkMasterToken && token !== ctx.masterToken) {
            return errorResponse(
              res,
              next,
              422,
              `Invalid ${token} for master token`,
            )
          }

          await handler({ req, res, next, token })
        } catch (error) {
          apiError(res, next, error)
        }
      },
    )
  }

  setupRoute("post", "/queue", async ({ req, res, next, token }) => {
    if (matrix === null) {
      return errorResponse(
        res,
        next,
        400,
        "Matrix is not configured for this server",
      )
    }

    let matrixRoom: string
    try {
      matrixRoom = await accessDb.db.get(token)
      if (!matrixRoom) {
        return errorResponse(res, next, 404)
      }
    } catch (error) {
      if (error instanceof LevelErrors.NotFoundError) {
        return errorResponse(res, next, 404)
      } else {
        return apiError(res, next, error)
      }
    }

    const ajv = new Ajv()
    const validateQueueEndpointInput = ajv.compile({
      type: "object",
      properties: {
        execPath: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        env: {
          type: "object",
          patternProperties: { ".*": { type: "string" } },
        },
        gitRef: {
          type: "object",
          properties: {
            contributor: { type: "string" },
            owner: { type: "string" },
            repo: { type: "string" },
            branch: { type: "string" },
          },
          required: ["contributor", "owner", "repo", "branch"],
        },
        secretsToHide: { type: "array", items: { type: "string" } },
      },
      required: ["execPath", "args", "gitRef"],
      additionalProperties: false,
    })
    const isInputValid = (await validateQueueEndpointInput(req.body)) as boolean
    if (!isInputValid) {
      return errorResponse(res, next, 400, validateQueueEndpointInput.errors)
    }

    type Payload = Pick<ApiTask, "execPath" | "args" | "gitRef"> & {
      env?: ApiTask["env"]
      secretsToHide?: string[]
    }
    const {
      execPath,
      args: inputArgs,
      gitRef,
      secretsToHide = [],
      env = {},
    } = req.body as Payload

    const args = parseTryRuntimeBotCommandArgs(ctx, inputArgs)
    if (typeof args === "string") {
      return errorResponse(res, next, 422, args)
    }

    const commandDisplay = displayCommand({ execPath, args, secretsToHide })
    const taskId = getNextTaskId()
    const queuedDate = new Date()

    const task: ApiTask = {
      id: taskId,
      tag: "ApiTask",
      timesRequeued: 0,
      timesRequeuedSnapshotBeforeExecution: 0,
      timesExecuted: 0,
      commandDisplay,
      execPath,
      args,
      env,
      gitRef,
      matrixRoom,
      repoPath: path.join(repositoryCloneDirectory, gitRef.repo),
      queuedDate: serializeTaskQueuedDate(queuedDate),
      requester: matrixRoom,
    }

    const message = await queueTask(ctx, task, {
      onResult: getSendTaskMatrixResult(matrix, logger, task),
    })

    response(res, next, 201, {
      message,
      task_id: taskId,
      info: `Send a DELETE request to ${getApiRoute(taskRoute)} for cancelling`,
    })
  })

  setupRoute("delete", taskRoute, ({ req, res, next }) => {
    const { task_id: taskId } = req.params
    if (typeof taskId !== "string" || !taskId) {
      return errorResponse(res, next, 403, "Invalid task_id")
    }

    const queuedTask = queuedTasks.get(taskId)
    if (queuedTask === undefined) {
      return errorResponse(res, next, 404)
    }

    void queuedTask.cancel()
    response(res, next, 200, queuedTask.task)
  })

  setupRoute(
    "post",
    "/access",
    async ({ req, res, next, token }) => {
      if (token !== ctx.masterToken) {
        return errorResponse(
          res,
          next,
          422,
          `Invalid ${token} for master token`,
        )
      }

      const { token: requesterToken, matrixRoom } = req.body
      if (typeof requesterToken !== "string" || !requesterToken) {
        return errorResponse(res, next, 400, "Invalid requesterToken")
      }
      if (typeof matrixRoom !== "string" || !matrixRoom) {
        return errorResponse(res, next, 400, "Invalid matrixRoom")
      }

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
      response(res, next, 201)
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
