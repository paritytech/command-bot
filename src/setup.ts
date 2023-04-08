import { createAppAuth } from "@octokit/auth-app";
import { request } from "@octokit/request";
import express from "express";
import promBundle from "express-prom-bundle";
import { MatrixClient, SimpleFsStorageProvider } from "matrix-bot-sdk";
import path from "path";
import { Probot, Server } from "probot";

import { setupApi } from "src/api";
import { setupBot } from "src/bot";
import { fetchCommandsConfiguration, getDocsFilename, LATEST } from "src/command-configs/fetchCommandsConfiguration";
import { config } from "src/config";
import { AccessDB, getDb, getSortedTasks, TaskDB } from "src/db";
import { logger } from "src/logger";
import { ensureDir, initDatabaseDir } from "src/shell";
import { requeueUnterminatedTasks } from "src/task";
import { Context } from "src/types";
import { Err, Ok } from "src/utils";

export const DOCS_URL_PATH = "/static/docs/";
export const GENERATED_DIR = path.join(process.cwd(), "generated");
export const DOCS_DIR = path.join(GENERATED_DIR, "docs");

export const setup = async (
  bot: Probot,
  server: Server,
  {
    shouldClearTaskDatabaseOnStart,
    ...partialContext
  }: Pick<Context, "disablePRComment" | "allowedOrganizations" | "gitlab"> & {
    shouldClearTaskDatabaseOnStart?: boolean;
  },
): Promise<void> => {
  const { dataPath } = config;
  const repositoryCloneDirectory = path.join(dataPath, "repositories");
  await ensureDir(repositoryCloneDirectory);
  await ensureDir(DOCS_DIR);

  // add the prometheus middleware to all routes
  server.expressApp.use(
    promBundle({
      includeMethod: true,
      includePath: true,
      includeStatusCode: true,
      includeUp: true,
      customLabels: { project_name: "command_bot", project_type: "metrics" },
      promClient: { collectDefaultMetrics: {} },
    }),
  );

  server.expressApp.use(DOCS_URL_PATH, express.static(DOCS_DIR));
  server.expressApp.get("/", (req, res) => {
    res.redirect(path.join(DOCS_URL_PATH, getDocsFilename(LATEST)), 301);
  });

  server.expressApp.get("/health", (req, res) => {
    res.send("OK");
  });

  const taskDbPath = path.join(dataPath, "db");
  await initDatabaseDir(taskDbPath);

  const taskDb = new TaskDB(getDb(taskDbPath));
  const tasks = await getSortedTasks({ taskDb, logger });
  logger.info({ tasks }, "Tasks found at the start of the application");

  if (shouldClearTaskDatabaseOnStart) {
    logger.info({}, "Clearing the task database during setup");
    for (const { id } of tasks) {
      await taskDb.db.del(id);
    }
  }

  const accessDbPath = path.join(dataPath, "access_db");
  await initDatabaseDir(accessDbPath);
  const accessDb = new AccessDB(getDb(accessDbPath));

  const authInstallation = createAppAuth({
    appId: config.appId,
    privateKey: config.privateKey,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    request: request.defaults({
      // GITHUB_BASE_URL variable allows us to mock requests to GitHub from integration tests
      ...(config.githubBaseUrl ? { baseUrl: config.githubBaseUrl } : {}),
    }),
  });
  const getFetchEndpoint = async (installationId: number | null) => {
    let token: string | null = null;
    let url: string;

    if (config.githubRemoteUrl) {
      url = config.githubRemoteUrl;
    } else if (installationId) {
      token = (await authInstallation({ type: "installation", installationId })).token;
      url = `https://x-access-token:${token}@github.com`;
    } else {
      url = "http://github.com";
    }

    return { url, token };
  };

  const matrixConfiguration = config.matrix;
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
            logger.info({}, `Connected to Matrix homeserver ${matrixConfiguration.homeServer}`);
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

  if (config.isDeployment && matrix === null) {
    throw new Error("Matrix configuration is expected for deployments");
  }

  const ctx: Context = {
    ...partialContext,
    taskDb,
    accessDb,
    getFetchEndpoint,
    log: bot.log,
    logger,
    matrix,
    repositoryCloneDirectory,
  };

  void requeueUnterminatedTasks(ctx, bot);

  setupBot(ctx, bot);
  setupApi(ctx, server);

  // if we re-deploy server, the "generated" folder will be wiped,
  // so we need to pre-fetch commands, so the documentation is available right away
  await fetchCommandsConfiguration(ctx);
};
