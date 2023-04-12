import { Logger } from "@eng-automation/js";

import type { TaskDB } from "src/db";

export type GitRef = {
  contributor: {
    owner: string;
    repo: string;
    branch: string;
  };
  upstream: {
    owner: string;
    repo: string;
    branch?: string;
  };
};

export type PipelineScripts = {
  repository: string;
  ref: string | undefined;
};

export type Context = {
  taskDb: TaskDB;
  getFetchEndpoint: (installationId: number | null) => Promise<{ token: string | null; url: string }>;
  log: (str: string) => void;
  allowedOrganizations: number[];
  logger: Logger;
  disablePRComment: boolean;
  repositoryCloneDirectory: string;
  gitlab: {
    accessToken: string;
    domain: string;
    pushNamespace: string;
    jobImage: string;
    accessTokenUsername: string;
  };
};

export type ToString = { toString: () => string };

export type CommandOutput = Error | string;
