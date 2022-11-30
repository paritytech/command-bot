import { createAppAuth } from "@octokit/auth-app";
import { request } from "@octokit/request";
import { MatrixClient, SimpleFsStorageProvider } from "matrix-bot-sdk";
import path from "path";
import { Probot, Server } from "probot";

import { AccessDB, getDb, getSortedTasks, TaskDB } from "src/db";

import { setupApi } from "./api";
import { setupBot } from "./bot";
import { logger } from "./logger";
import { ensureDir, initDatabaseDir } from "./shell";
import { requeueUnterminatedTasks } from "./task";
import { Context } from "./types";
import { Err, Ok } from "./utils";

export const setup = async (
  bot: Probot,
  server: Server,
  {
    appId,
    clientId,
    clientSecret,
    privateKey,
    dataPath,
    matrix: matrixConfiguration,
    shouldClearTaskDatabaseOnStart,
    isDeployment,
    ...partialContext
  }: Pick<
    Context,
    | "isDeployment"
    | "shouldPostPullRequestComment"
    | "allowedOrganizations"
    | "masterToken"
    | "gitlab"
    | "pipelineScripts"
  > & {
    appId: number;
    clientId: string;
    clientSecret: string;
    privateKey: string;
    startDate: Date;
    dataPath: string;
    matrix:
      | {
          homeServer: string;
          accessToken: string;
        }
      | undefined;
    shouldClearTaskDatabaseOnStart?: boolean;
  },
): Promise<void> => {
  const repositoryCloneDirectory = path.join(dataPath, "repositories");
  await ensureDir(repositoryCloneDirectory);

  const taskDbPath = path.join(dataPath, "db");
  await initDatabaseDir(taskDbPath);

  const taskDb = new TaskDB(getDb(taskDbPath));
  const tasks = await getSortedTasks({ taskDb, logger });
  logger.info(tasks, "Tasks found at the start of the application");

  if (shouldClearTaskDatabaseOnStart) {
    logger.info("Clearing the task database during setup");
    for (const { id } of tasks) {
      await taskDb.db.del(id);
    }
  }

  const accessDbPath = path.join(dataPath, "access_db");
  await initDatabaseDir(accessDbPath);
  const accessDb = new AccessDB(getDb(accessDbPath));

  const authInstallation = createAppAuth({
    appId,
    privateKey,
    clientId,
    clientSecret,
    request: request.defaults({
      // GITHUB_BASE_URL variable allows us to mock requests to GitHub from integration tests
      ...(process.env.GITHUB_BASE_URL ? { baseUrl: process.env.GITHUB_BASE_URL } : {}),
    }),
  });
  const getFetchEndpoint = async (installationId: number | null) => {
    let token: string | null = null;
    let url: string;

    if (process.env.GITHUB_REMOTE_URL) {
      url = process.env.GITHUB_REMOTE_URL;
    } else if (installationId) {
      token = (await authInstallation({ type: "installation", installationId })).token;
      url = `https://x-access-token:${token}@github.com`;
    } else {
      url = "http://github.com";
    }

    return { url, token };
  };

  const matrixClientSetup: Ok<MatrixClient | null> | Err<unknown> = await (matrixConfiguration === undefined
    ? Promise.resolve(new Ok(null))
    : new Promise((resolve) => {
        const matrixClient = new MatrixClient(
          matrixConfiguration.homeServer,
          matrixConfiguration.accessToken,
          new SimpleFsStorageProvider(path.join(dataPath, "matrix.json")),
        );
        matrixClient
          .start()
          .then(() => {
            logger.info(`Connected to Matrix homeserver ${matrixConfiguration.homeServer}`);
            resolve(new Ok(matrixClient));
          })
          .catch((error) => {
            resolve(new Err(error));
          });
      }));
  if (matrixClientSetup instanceof Err) {
    throw matrixClientSetup.value;
  }

  const { value: matrix } = matrixClientSetup;

  if (isDeployment && matrix === null) {
    throw new Error("Matrix configuration is expected for deployments");
  }

  const ctx: Context = {
    ...partialContext,
    taskDb,
    accessDb,
    getFetchEndpoint,
    log: bot.log,
    logger,
    isDeployment,
    matrix,
    repositoryCloneDirectory,
  };

  void requeueUnterminatedTasks(ctx, bot);

  setupBot(ctx, bot);

  setupApi(ctx, server);
};
