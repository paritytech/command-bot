import http from "http";
import { Probot, Server } from "probot";
import stoppable from "stoppable";

import { config } from "src/config";
import { logger, probotLogger } from "src/logger";
import { setup } from "src/setup";

const main = async () => {
  const bot = Probot.defaults({
    appId: config.appId,
    privateKey: config.privateKey,
    secret: config.webhookSecret,
    logLevel: "info",
    ...(probotLogger === undefined ? {} : { log: probotLogger.child({ name: "probot" }) }),
    // GITHUB_BASE_URL variable allows us to mock requests to GitHub from integration tests
    ...(config.githubBaseUrl ? { baseUrl: config.githubBaseUrl } : {}),
  });
  const server = new Server({
    Probot: bot,
    ...(probotLogger === undefined ? {} : { log: probotLogger.child({ name: "server" }) }),
    // WEBHOOK_PORT is expected to be used only in tests, for now. It allows us to escape port allocation erros
    ...(config.webhookPort ? { port: config.webhookPort } : {}),
    webhookProxy: config.webhookProxy,
  });

  await new Promise((resolve, reject) => {
    server
      .load(
        (probot) =>
          void setup(probot, server, {
            disablePRComment: config.disablePRComment,
            allowedOrganizations: config.allowedOrganizations,
            shouldClearTaskDatabaseOnStart: config.shouldClearTaskDatabaseOnStart,
            gitlab: {
              accessToken: config.gitlabAccessToken,
              accessTokenUsername: config.gitlabAccessTokenUsername,
              domain: config.gitlabDomain,
              pushNamespace: config.gitlabPushNamespace,
              defaultJobImage: config.gitlabJobImage,
            },
          }).then(resolve, reject),
      )
      .catch(reject);
  });

  await server.start();
  logger.info({}, "Probot has started!");

  if (config.pingPort) {
    // Signal that we have started listening until Probot kicks in
    const pingServer = stoppable(
      http.createServer((_, res) => {
        res.writeHead(200);
        res.end();
      }),
      0,
    );
    pingServer.listen(config.pingPort);
  }
};

void main();
