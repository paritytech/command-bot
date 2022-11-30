import assert from "assert";
import { readFile, writeFile } from "fs/promises";
import http from "http";
import path from "path";
import { Logger as ProbotLogger, Probot, Server } from "probot";
import { getLog } from "probot/lib/helpers/get-log";
import stoppable from "stoppable";

import { logFormat, logger } from "./logger";
import { setup } from "./setup";
import { ensureDir } from "./shell";
import { envNumberVar, envVar } from "./utils";

const main = async () => {
  const startDate = new Date();

  const masterToken = envVar("MASTER_TOKEN");

  const shouldPostPullRequestComment = (() => {
    const value = process.env.POST_COMMENT;
    switch (value) {
      case "false": {
        return false;
      }
      case undefined:
      case "true": {
        return true;
      }
      default: {
        throw new Error(`Invalid $POST_COMMENT: ${value}`);
      }
    }
  })();

  const dataPath = envVar("DATA_PATH");
  await ensureDir(dataPath);

  const appDbVersionPath = path.join(dataPath, "task-db-version");
  const shouldClearTaskDatabaseOnStart = process.env.TASK_DB_VERSION
    ? await (async (appDbVersion) => {
        const currentDbVersion = await (async () => {
          try {
            return (await readFile(appDbVersionPath)).toString().trim();
          } catch (error) {
            if (
              /*
              Test for the following error:
                [Error: ENOENT: no such file or directory, open '/foo'] {
                  errno: -2,
                  code: 'ENOENT',
                  syscall: 'unlink',
                  path: '/foo'
                }
              */
              !(error instanceof Error) ||
              (error as { code?: string })?.code !== "ENOENT"
            ) {
              throw error;
            }
          }
        })();
        if (currentDbVersion !== appDbVersion) {
          await writeFile(appDbVersionPath, appDbVersion);
          return true;
        }
      })(process.env.TASK_DB_VERSION.trim())
    : false;

  const appId = envNumberVar("APP_ID");
  const privateKey = Buffer.from(envVar("PRIVATE_KEY_BASE64"), "base64").toString();
  const clientId = envVar("CLIENT_ID");
  const clientSecret = envVar("CLIENT_SECRET");
  const webhookSecret = envVar("WEBHOOK_SECRET");

  let probotLogger: ProbotLogger | undefined = undefined;
  switch (logFormat) {
    case "json": {
      probotLogger = getLog({ level: "error", logFormat: "json", logLevelInString: true, logMessageKey: "msg" });
      break;
    }
    case null: {
      break;
    }
    default: {
      const exhaustivenessCheck: never = logFormat;
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Not exhaustive: ${exhaustivenessCheck}`);
    }
  }

  const bot = Probot.defaults({
    appId,
    privateKey,
    secret: webhookSecret,
    logLevel: "info",
    ...(probotLogger === undefined ? {} : { log: probotLogger.child({ name: "probot" }) }),
    // GITHUB_BASE_URL variable allows us to mock requests to GitHub from integration tests
    ...(process.env.GITHUB_BASE_URL ? { baseUrl: process.env.GITHUB_BASE_URL } : {}),
  });
  const server = new Server({
    Probot: bot,
    ...(probotLogger === undefined ? {} : { log: probotLogger.child({ name: "server" }) }),
    // WEBHOOK_PORT is expected to be used only in tests, for now. It allows us to escape port allocation erros
    ...(process.env.WEBHOOK_PORT ? { port: parseInt(process.env.WEBHOOK_PORT) } : {}),
    webhookProxy: process.env.WEBHOOK_PROXY_URL,
  });

  const allowedOrganizations = envVar("ALLOWED_ORGANIZATIONS")
    .split(",")
    .filter((value) => value.length !== 0)
    .map((value) => {
      const parsedValue = parseInt(value);
      assert(parsedValue);
      return parsedValue;
    });
  assert(allowedOrganizations.length);

  const matrix = (() => {
    if (process.env.MATRIX_HOMESERVER) {
      return { homeServer: process.env.MATRIX_HOMESERVER, accessToken: envVar("MATRIX_ACCESS_TOKEN") };
    } else {
      return undefined;
    }
  })();

  const gitlabAccessToken = envVar("GITLAB_ACCESS_TOKEN");
  const gitlabAccessTokenUsername = envVar("GITLAB_ACCESS_TOKEN_USERNAME");
  const gitlabDomain = envVar("GITLAB_DOMAIN");
  const gitlabPushNamespace = envVar("GITLAB_PUSH_NAMESPACE");
  const gitlabJobImage = envVar("GITLAB_JOB_IMAGE");

  const pipelineScripts = (() => {
    const pipelineScriptsRepository = process.env.PIPELINE_SCRIPTS_REPOSITORY;
    if (pipelineScriptsRepository) {
      return { repository: pipelineScriptsRepository, ref: process.env.PIPELINE_SCRIPTS_REF };
    }
  })();

  await new Promise((resolve, reject) => {
    server
      .load(
        (probot) =>
          void setup(probot, server, {
            appId,
            clientId,
            clientSecret,
            privateKey,
            startDate,
            shouldPostPullRequestComment,
            allowedOrganizations,
            dataPath,
            matrix,
            masterToken,
            shouldClearTaskDatabaseOnStart,
            isDeployment: !!process.env.IS_DEPLOYMENT,
            pipelineScripts,
            gitlab: {
              accessToken: gitlabAccessToken,
              accessTokenUsername: gitlabAccessTokenUsername,
              domain: gitlabDomain,
              pushNamespace: gitlabPushNamespace,
              jobImage: gitlabJobImage,
            },
          }).then(resolve, reject),
      )
      .catch(reject);
  });

  await server.start();
  logger.info("Probot has started!");

  if (process.env.PING_PORT) {
    // Signal that we have started listening until Probot kicks in
    const pingPort = parseInt(process.env.PING_PORT);
    const pingServer = stoppable(
      http.createServer((_, res) => {
        res.writeHead(200);
        res.end();
      }),
      0,
    );
    pingServer.listen(pingPort);
  }
};

void main();
