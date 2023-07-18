import { createAppAuth } from "@octokit/auth-app";
import { request } from "@octokit/request";
import express from "express";
import promBundle from "express-prom-bundle";
import path from "path";
import { Probot, Server } from "probot";

import { setupApi } from "src/api";
import { setupBot } from "src/bot";
import { fetchCommandsConfiguration, getDocsFilename } from "src/command-configs/fetchCommandsConfiguration";
import { config } from "src/config";
import { getDb, getSortedTasks, TaskDB } from "src/db";
import { logger } from "src/logger";
import { ensureDir, initDatabaseDir } from "src/shell";
import { requeueUnterminatedTasks } from "src/task";
import { Context } from "src/types";

export const DOCS_URL_PATH = "/static/docs/";
export const GENERATED_DIR = path.join(process.cwd(), "generated");
export const DOCS_DIR = path.join(GENERATED_DIR, "docs");

// -v --variable to override scripts branch to test new features
export const PIPELINE_SCRIPTS_REF = "PIPELINE_SCRIPTS_REF";

// -v --variable to override default image revision
export const CMD_IMAGE = "CMD_IMAGE";

export const LATEST = "latest";

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

  const ctx: Context = { ...partialContext, taskDb, getFetchEndpoint, log: bot.log, logger, repositoryCloneDirectory };

  void requeueUnterminatedTasks(ctx, bot);

  setupBot(ctx, bot);
  setupApi(ctx, server);

  // if we re-deploy server, the "generated" folder will be wiped,
  // so we need to pre-fetch commands, so the documentation is available right away
  await fetchCommandsConfiguration(ctx);
};
