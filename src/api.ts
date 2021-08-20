import Ajv from "ajv"
import bodyParser from "body-parser"
import { NextFunction, Response } from "express"
import { NotFoundError } from "level-errors"
import path from "path"
import { Server } from "probot"

import { KeyAlreadyExists } from "./db"
import { getApiTaskHandle, getRegisterApiTaskHandle, queue } from "./executor"
import { ApiTask, State } from "./types"
import { displayCommand, getSendMatrixResult } from "./utils"

const getApiRoute = function (route: string) {
  return `/api${route}`
}

export const setupApi = function (server: Server, state: State) {
  const {
    accessDb,
    matrix,
    repositoryCloneDirectory,
    logger,
    getUniqueId,
    version,
  } = state

  const respond = function <T>(
    res: Response,
    next: NextFunction,
    code: number,
    body?: T,
  ) {
    if (body === undefined) {
      res.status(code).send()
    } else {
      res.status(code).json(body)
    }
    next()
  }

  const serverError = function (res: Response, next: NextFunction, error: any) {
    logger.fatal(error, "Failed to handle errors in API endpoint")
    respond(res, next, 500)
  }

  const err = function <T>(
    res: Response,
    next: NextFunction,
    code: number,
    body?: T,
  ) {
    respond(res, next, code, body === undefined ? undefined : { error: body })
  }

  server.expressApp.use(bodyParser.json())

  server.expressApp.post(
    getApiRoute("/queue"),
    async function (req, res, next) {
      try {
        const token = req.headers["x-auth"]
        if (typeof token !== "string" || !token) {
          return err(res, next, 400, "Invalid auth token")
        }

        if (matrix === null) {
          return err(res, next, 400, "Matrix is not configured for this server")
        }

        let matrixRoom: string
        try {
          matrixRoom = await accessDb.db.get(token)
          if (!matrixRoom) {
            throw new NotFoundError("Not found")
          }
        } catch (error) {
          if (error instanceof NotFoundError) {
            return err(res, next, 404)
          } else {
            logger.fatal(error, "Unhandled error for database get")
            return err(res, next, 500)
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
        const isInputValid = validateQueueEndpointInput(req.body)
        if (!isInputValid) {
          return err(res, next, 400, validateQueueEndpointInput.errors)
        }

        const {
          execPath,
          args,
          gitRef,
          secretsToHide = [],
          env = {},
        }: Pick<ApiTask, "execPath" | "args" | "gitRef"> & {
          env?: ApiTask["env"]
          secretsToHide?: string[]
        } = req.body

        const commandDisplay = displayCommand({ execPath, args, secretsToHide })
        const handleId = getUniqueId()

        const taskData: ApiTask = {
          tag: "ApiTask",
          version,
          handleId,
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
        }

        const message = await queue({
          state,
          taskData,
          onResult: getSendMatrixResult(matrix, logger, taskData),
          registerHandle: getRegisterApiTaskHandle(taskData),
        })

        respond(res, next, 201, {
          message,
          handleId,
          info: "Send a JSON POST request to /api/cancel with '{ handleId }' for cancelling",
        })
      } catch (error) {
        return serverError(res, next, error)
      }
    },
  )

  server.expressApp.post(
    getApiRoute("/cancel"),
    async function (req, res, next) {
      try {
        const { handleId } = req.body
        if (typeof handleId !== "string" || !handleId) {
          return err(res, next, 403, "Invalid handleId")
        }

        const cancelHandle = getApiTaskHandle(handleId)
        if (cancelHandle === undefined) {
          return err(res, next, 404)
        }

        const { cancel, task } = cancelHandle
        await cancel()

        respond(res, next, 200, task)
      } catch (error) {
        return serverError(res, next, error)
      }
    },
  )

  server.expressApp.post(
    getApiRoute("/access"),
    async function (req, res, next) {
      try {
        const token = req.headers["x-auth"]
        if (typeof token !== "string" || !token) {
          return err(res, next, 400, "Invalid auth token")
        }
        if (token !== state.masterToken) {
          return err(res, next, 422, `Invalid ${token} for master token`)
        }

        const { requesterToken, matrixRoom } = req.body
        if (typeof requesterToken !== "string" || !requesterToken) {
          return err(res, next, 400, "Invalid requesterToken")
        }
        if (typeof matrixRoom !== "string" || !matrixRoom) {
          return err(res, next, 400, "Invalid matrixRoom")
        }

        try {
          if (await accessDb.db.get(requesterToken)) {
            throw new KeyAlreadyExists()
          }
        } catch (error) {
          if (error instanceof KeyAlreadyExists) {
            return err(res, next, 422, "requesterToken already exists")
          } else if (!(error instanceof NotFoundError)) {
            logger.fatal(error, "Unhandled error for database get")
            return err(res, next, 500)
          }
        }

        await accessDb.db.put(requesterToken, matrixRoom)
        respond(res, next, 201)
      } catch (error) {
        return serverError(res, next, error)
      }
    },
  )

  server.expressApp.patch(
    getApiRoute("/access"),
    async function (req, res, next) {
      try {
        const token = req.headers["x-auth"]
        if (typeof token !== "string" || !token) {
          return err(res, next, 400, "Invalid auth token")
        }

        const { matrixRoom } = req.body
        if (typeof matrixRoom !== "string" || !matrixRoom) {
          return err(res, next, 400, "Invalid matrixRoom")
        }

        try {
          const value = await accessDb.db.get(token)
          if (!value) {
            throw new NotFoundError("Not found")
          }
        } catch (error) {
          if (error instanceof NotFoundError) {
            return err(res, next, 404)
          } else {
            logger.fatal(error, "Unhandled error for database get")
            return err(res, next, 500)
          }
        }

        await accessDb.db.put(token, matrixRoom)
        respond(res, next, 204)
      } catch (error) {
        return serverError(res, next, error)
      }
    },
  )

  server.expressApp.delete(
    getApiRoute("/access"),
    async function (req, res, next) {
      try {
        const token = req.headers["x-auth"]
        if (typeof token !== "string" || !token) {
          return err(res, next, 400, "Invalid auth token")
        }

        try {
          const value = await accessDb.db.get(token)
          if (!value) {
            throw new NotFoundError("Not found")
          }
        } catch (error) {
          if (error instanceof NotFoundError) {
            return err(res, next, 404)
          } else {
            logger.fatal(error, "Unhandled error for database get")
            return err(res, next, 500)
          }
        }

        await accessDb.db.put(token, "")
        respond(res, next, 204)
      } catch (error) {
        return serverError(res, next, error)
      }
    },
  )
}
