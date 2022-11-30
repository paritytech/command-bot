import bodyParser from "body-parser";
import { randomUUID } from "crypto";
import { NextFunction, RequestHandler, Response } from "express";
import Joi from "joi";
import LevelErrors from "level-errors";
import path from "path";
import { Server } from "probot";

import { commandsConfiguration } from "./core";
import { validateSingleShellCommand } from "./shell";
import {
  ApiTask,
  cancelTask,
  getNextTaskId,
  getSendTaskMatrixResult,
  queueTask,
  serializeTaskQueuedDate,
} from "./task";
import { Context } from "./types";

const getApiRoute = (route: string): string => `/api${route}`;

const taskRoute = "/task/:task_id";

export const getApiTaskEndpoint = (task: ApiTask): string => getApiRoute(taskRoute).replaceAll(":task_id", task.id);

const response = <T>(res: Response, next: NextFunction, code: number, body?: T) => {
  if (body === undefined) {
    res.status(code).send();
  } else {
    res.status(code).json(body);
  }
  next();
};

const errorResponse = <T>(res: Response, next: NextFunction, code: number, body?: T) => {
  response(res, next, code, body === undefined ? undefined : { error: body });
};

const jsonBodyParserMiddleware = bodyParser.json();

export const setupApi = (ctx: Context, server: Server): void => {
  const { accessDb, matrix, repositoryCloneDirectory, logger, gitlab } = ctx;

  const apiError = (res: Response, next: NextFunction, error: unknown) => {
    const msg = "Failed to handle errors in API endpoint";
    logger.fatal(error, msg);
    errorResponse(res, next, 500, msg);
  };

  type JsonRequestHandlerParams = Parameters<RequestHandler<Record<string, unknown>, unknown, Record<string, unknown>>>;
  const setupRoute = <T extends "post" | "get" | "delete" | "patch">(
    method: T,
    routePath: string,
    handler: (args: {
      req: JsonRequestHandlerParams[0];
      res: JsonRequestHandlerParams[1];
      next: JsonRequestHandlerParams[2];
      token: string;
      matrixRoom: string;
    }) => void | Promise<void>,
    { checkMasterToken }: { checkMasterToken?: boolean } = {},
  ) => {
    server.expressApp[method](getApiRoute(routePath), jsonBodyParserMiddleware, async (req, res, next) => {
      try {
        const token = req.headers["x-auth"];
        if (typeof token !== "string" || !token) {
          return errorResponse(res, next, 400, "Invalid auth token");
        }

        /*
            Empty when the masterToken is supposed to be used because it doesn't
            matter in that case
          */
        let matrixRoom: string = "";
        if (checkMasterToken) {
          if (token !== ctx.masterToken) {
            return errorResponse(res, next, 422, `Invalid ${token} for master token`);
          }
        } else {
          try {
            matrixRoom = await accessDb.db.get(token);
          } catch (error) {
            if (error instanceof LevelErrors.NotFoundError) {
              return errorResponse(res, next, 404, "Token not found");
            } else {
              return apiError(res, next, error);
            }
          }
        }

        await handler({ req, res, next, token, matrixRoom });
      } catch (error) {
        apiError(res, next, error);
      }
    });
  };

  setupRoute("post", "/queue", async ({ req, res, next, matrixRoom }) => {
    if (matrix === null) {
      return errorResponse(res, next, 400, "Matrix is not configured for this server");
    }

    const validation = Joi.object()
      .keys({
        configuration: Joi.string().required(),
        args: Joi.array().items(Joi.string()).required(),
        variables: Joi.object().pattern(/.*/, [Joi.string(), Joi.number(), Joi.boolean()]),
        gitRef: Joi.object().keys({
          contributor: Joi.object().keys({
            owner: Joi.string().required(),
            repo: Joi.string().required(),
            branch: Joi.string().required(),
          }),
          upstream: Joi.object().keys({
            owner: Joi.string().required(),
            repo: Joi.string().required(),
            branch: Joi.string(),
          }),
        }),
      })
      .validate(req.body);
    if (validation.error) {
      return errorResponse(res, next, 422, validation.error);
    }

    const {
      configuration: configurationName,
      gitRef,
      args,
      variables,
    } = req.body as Pick<ApiTask, "gitRef"> & {
      configuration: string;
      args: string[];
      variables?: Record<string, number | boolean | string>;
    };

    const configuration =
      configurationName in commandsConfiguration
        ? commandsConfiguration[configurationName as keyof typeof commandsConfiguration]
        : undefined;
    if (!configuration) {
      return errorResponse(
        res,
        next,
        422,
        `Could not find matching configuration for ${configurationName}; available ones are ${Object.keys(
          commandsConfiguration,
        ).join(", ")}.`,
      );
    }

    const command = await validateSingleShellCommand([...configuration.commandStart, ...args].join(" "));
    if (command instanceof Error) {
      return errorResponse(res, next, 422, command.message);
    }

    const taskId = getNextTaskId();
    const queuedDate = new Date();

    const task: ApiTask = {
      id: taskId,
      tag: "ApiTask",
      timesRequeued: 0,
      timesRequeuedSnapshotBeforeExecution: 0,
      timesExecuted: 0,
      gitRef,
      matrixRoom,
      repoPath: path.join(repositoryCloneDirectory, gitRef.upstream.repo),
      queuedDate: serializeTaskQueuedDate(queuedDate),
      requester: matrixRoom,
      command,
      gitlab: {
        job: {
          ...configuration.gitlab.job,
          variables: { ...configuration.gitlab.job.variables, ...variables },
          image: gitlab.jobImage,
        },
        pipeline: null,
      },
    };

    const updateProgress = getSendTaskMatrixResult(matrix, task);
    const queueMessage = await queueTask(ctx, task, { onResult: updateProgress, updateProgress });

    response(res, next, 201, { task, queueMessage });
  });

  setupRoute("delete", taskRoute, async ({ req, res, next }) => {
    const { task_id: taskId } = req.params;
    if (typeof taskId !== "string" || !taskId) {
      return errorResponse(res, next, 403, "Invalid task_id");
    }

    const cancelError = await cancelTask(ctx, taskId);
    if (cancelError instanceof LevelErrors.NotFoundError) {
      return errorResponse(res, next, 404, "Task not found");
    }

    response(res, next, 204);
  });

  setupRoute(
    "post",
    "/access",
    async ({ req, res, next }) => {
      const { matrixRoom } = req.body;
      if (typeof matrixRoom !== "string" || !matrixRoom) {
        return errorResponse(res, next, 400, "Invalid matrixRoom");
      }

      const requesterToken = randomUUID();
      try {
        if (await accessDb.db.get(requesterToken)) {
          return errorResponse(res, next, 422, "requesterToken already exists");
        }
      } catch (error) {
        if (!(error instanceof LevelErrors.NotFoundError)) {
          return apiError(res, next, error);
        }
      }

      await accessDb.db.put(requesterToken, matrixRoom);
      response(res, next, 201, { token: requesterToken });
    },
    { checkMasterToken: true },
  );

  setupRoute("patch", "/access", async ({ req, res, next, token }) => {
    const { matrixRoom } = req.body;
    if (typeof matrixRoom !== "string" || !matrixRoom) {
      return errorResponse(res, next, 400, "Invalid matrixRoom");
    }

    try {
      const value = await accessDb.db.get(token);
      if (!value) {
        return errorResponse(res, next, 404);
      }
    } catch (error) {
      if (error instanceof LevelErrors.NotFoundError) {
        return errorResponse(res, next, 404);
      } else {
        return apiError(res, next, error);
      }
    }

    await accessDb.db.put(token, matrixRoom);
    response(res, next, 204);
  });

  setupRoute("delete", "/access", async ({ res, next, token }) => {
    try {
      const value = await accessDb.db.get(token);
      if (!value) {
        return errorResponse(res, next, 404);
      }
    } catch (error) {
      if (error instanceof LevelErrors.NotFoundError) {
        return errorResponse(res, next, 404);
      } else {
        return apiError(res, next, error);
      }
    }

    await accessDb.db.put(token, "");
    response(res, next, 204);
  });
};
