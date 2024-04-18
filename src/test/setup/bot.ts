import { ensureDefined, until } from "@eng-automation/js";
import { ChildProcess, spawn } from "child_process";
import { readFileSync, rmSync } from "fs";
import fetch from "node-fetch";
import path from "path";

import { GitDaemons } from "./gitDaemons";
import { selfSignedCertPath } from "./mockServers";
import { findFreePorts } from "./util";

let bot: ChildProcess | null = null;
export const getBotInstance = (): ChildProcess | null => bot;

let webhookPort: number | null = null;
export const getWebhookPort = (): number | null => webhookPort;

let pingPort: number | null = null;
export const getPingPort = (): number | null => pingPort;

export async function launchBot(gitHubUrl: string, gitLabUrl: string, gitDaemons: GitDaemons): Promise<ChildProcess> {
  rmSync(path.join(process.cwd(), "data", "access_db"), { recursive: true, force: true });
  rmSync(path.join(process.cwd(), "data", "db"), { recursive: true, force: true });
  rmSync(path.join(process.cwd(), "generated"), { recursive: true, force: true });
  [webhookPort, pingPort] = await findFreePorts(2);

  const botEnv = getBotEnv(gitHubUrl, gitLabUrl, gitDaemons.gitHub.url, gitDaemons.gitLab.url);
  console.log(`Launching bot with
    GitHub HTTP: ${gitHubUrl},
    GitLab HTTP: ${gitLabUrl},
    GitHub git: ${gitDaemons.gitHub.url},
    GitLab git: ${gitDaemons.gitLab.url}`);

  bot = spawn("yarn", ["start"], { env: Object.assign({}, process.env, botEnv), stdio: "pipe" });

  await new Promise<void>((resolve, reject) => {
    const crashHandler = (code: number | null, signal: string | null) => {
      const message = "bot exited with " + (code === null ? `signal ${String(signal)}` : `code ${String(code)}`);
      console.log(message);
      reject(new Error(message));
    };

    const instance = ensureDefined<ChildProcess>(bot);

    until(
      async () => {
        try {
          await fetch(`http://localhost:${ensureDefined(pingPort)}`);
          return true;
        } catch (e) {
          return false;
        }
      },
      1000,
      50,
      `bot did not start to listen on ping port: ${ensureDefined(pingPort)}`,
    ).then(resolve, reject);

    instance.stdout?.on("data", (dataBuf: Buffer) => {
      const data: string = dataBuf.toString();
      console.log(`>>> Bot said: ${data}`);

      if (data.includes("Probot has started!")) {
        instance.off("exit", crashHandler);
        resolve();
      }
    });

    instance.stderr?.on("data", (dataBuf: Buffer) => {
      const data = dataBuf.toString();
      console.log(`>>> Bot said (stderr): ${data}`);
    });

    instance.on("exit", crashHandler);
  });

  return bot;
}

function getBotEnv(
  gitHubUrl: string,
  gitLabUrl: string,
  gitHubRemoteUrl: string,
  gitLabRemoteUrl: string,
): Record<string, string> {
  return {
    GITLAB_DOMAIN: new URL(gitLabUrl).host,
    GITHUB_BASE_URL: gitHubUrl,
    MASTER_TOKEN: "master_token",
    DATA_PATH: path.join(process.cwd(), "data"),

    PIPELINE_SCRIPTS_REPOSITORY: "https://github.com/paritytech/command-bot-scripts",
    PIPELINE_SCRIPTS_REF: "main",

    PRIVATE_KEY_BASE64: readFileSync(path.join(process.cwd(), "src", "test", "testing-app.txt"), "base64"),

    WEBHOOK_SECRET: "webhook_secret_value",
    WEBHOOK_PORT: String(webhookPort),

    PING_PORT: String(pingPort),

    APP_ID: "123",
    CLIENT_ID: "client_id_value",
    CLIENT_SECRET: "client_secret_value",
    ALLOWED_ORGANIZATIONS: "123,456",

    GITLAB_ACCESS_TOKEN_USERNAME: "gitlab_token_holder",
    GITLAB_ACCESS_TOKEN: "gitlab_access_token_value",

    GITLAB_PUSH_NAMESPACE: "paritytech-stg",
    GITLAB_JOB_IMAGE: "quay.io/buildah/stable",

    GITLAB_REMOTE_URL: gitLabRemoteUrl,
    GITHUB_REMOTE_URL: gitHubRemoteUrl,
    GITLAB_PIPELINE_UPDATE_INTERVAL: "300",

    CMD_BOT_URL: "http://localhost:3000/",

    NODE_EXTRA_CA_CERTS: selfSignedCertPath,

    MIN_LOG_LEVEL: "debug",

    BOT_PR_COMMENT_MENTION: "testbot",

    PROCESSBOT_SUPPORTED_REPOS: "substrate,polkadot,cumulus,command-bot-test",
  };
}
