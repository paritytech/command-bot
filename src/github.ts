import { Logger } from "@eng-automation/js";
import { OctokitResponse } from "@octokit/plugin-paginate-rest/dist-types/types";
import { RequestError } from "@octokit/request-error";
import { EndpointInterface, Endpoints, RequestInterface } from "@octokit/types";
import { IssueComment } from "@octokit/webhooks-types";
import { Mutex } from "async-mutex";
import { Probot } from "probot";

import { config } from "src/config";
import { PullRequestTask } from "src/task";
import { CommandOutput, Context } from "src/types";
import { displayError, Err, millisecondsDelay, Ok } from "src/utils";

type Octokit = Awaited<ReturnType<Probot["auth"]>>;

const wasOctokitExtendedByApplication = Symbol();

export type ExtendedOctokit = Octokit & {
  orgs: Octokit["orgs"] & {
    userMembershipByOrganizationId: {
      (params: { organization_id: number; username: string }): Promise<
        Endpoints["GET /orgs/{org}/members/{username}"]["response"]
      >;
      defaults: RequestInterface["defaults"];
      endpoint: EndpointInterface<{
        url: string;
      }>;
    };
  };
  [wasOctokitExtendedByApplication]: boolean;
};

// Funnel all GitHub requests through a Mutex in order to avoid rate limits
const requestMutex = new Mutex();
let requestDelay = Promise.resolve();

const rateLimitRemainingHeader = "x-ratelimit-remaining";
const rateLimitResetHeader = "x-ratelimit-reset";
const retryAfterHeader = "retry-after";
export const getOctokit = (octokit: Octokit, ctx: Context): ExtendedOctokit => {
  const { logger: log } = ctx;
  /*
    Check that this Octokit instance has not been augmented before because
    side-effects of this function should not be stacked; e.g. registering
    request wrappers more than once will break the application
  */
  if ((octokit as ExtendedOctokit)[wasOctokitExtendedByApplication]) {
    return octokit as ExtendedOctokit;
  }

  Object.assign(octokit.orgs, {
    userMembershipByOrganizationId: octokit.request.defaults({
      method: "GET",
      url: "/organizations/:organization_id/members/:username",
    }),
  });

  octokit.hook.wrap("request", async (request, options) => {
    log.debug({ request, options }, "Preparing to send a request to the GitHub API");

    let triesCount = 0;
    /* FIXME to get a good return type here, the function should be split.
         Will do in later iterations, or more likely,
         will drop whole file in favour of a shared module
         @see https://github.com/paritytech/opstooling/issues/117 */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: Ok<OctokitResponse<any>> | Err<any> | undefined = await requestMutex.runExclusive(async () => {
      try {
        await requestDelay;

        for (; triesCount < 3; triesCount++) {
          if (triesCount) {
            log.debug({}, `Retrying Octokit request (tries so far: ${triesCount})`);
          }

          try {
            return new Ok(await request(options));
          } catch (error) {
            if (!(error instanceof RequestError)) {
              return new Err(error);
            }

            const { status, message } = error;
            log.error(
              error,
              `Error while querying GitHub API: url: ${error.request.url}, status: ${status}, message: ${message}`,
            );
            const isApiRateLimitResponse = message.startsWith("You have exceeded a secondary rate limit.");
            /*
              4XX status codes indicates a "client error", thus we assume the
              request is invalid and therefore there's no point in retrying it
              */
            if (!isApiRateLimitResponse && status >= 400 && status < 500) {
              return new Err(error);
            }

            const { response } = error;
            const fallbackWaitDuration = 1000;
            const waitDuration =
              response === undefined
                ? /*
                    We don't know what to make of this error since its response is
                    empty, so just use a fallback wait duration
                  */ fallbackWaitDuration
                : (() => {
                    const { headers } = response;
                    if (parseInt(headers[rateLimitRemainingHeader] ?? "") === 0) {
                      // https://docs.github.com/en/rest/overview/resources-in-the-rest-api#rate-limit-http-headers
                      log.warn(
                        {},
                        `GitHub API limits were hit! The "${rateLimitResetHeader}" response header will be read to figure out until when we're supposed to wait...`,
                      );
                      const rateLimitResetHeaderValue = headers[rateLimitResetHeader];
                      const resetEpoch = parseInt(rateLimitResetHeaderValue ?? "") * 1000;
                      if (Number.isNaN(resetEpoch)) {
                        log.error(
                          { rateLimitResetHeaderValue, rateLimitResetHeader, headers },
                          `GitHub response header "${rateLimitResetHeader}" could not be parsed as epoch`,
                        );
                      } else {
                        const currentEpoch = Date.now();
                        const duration = resetEpoch - currentEpoch;
                        if (duration < 0) {
                          log.error(
                            { rateLimitResetHeaderValue, resetEpoch, currentEpoch, headers },
                            `Parsed epoch value for GitHub response header "${rateLimitResetHeader}" is smaller than the current date`,
                          );
                        } else {
                          return duration;
                        }
                      }
                    } else if (headers[retryAfterHeader] !== undefined) {
                      // https://docs.github.com/en/rest/guides/best-practices-for-integrators#dealing-with-secondary-rate-limits
                      const retryAfterHeaderValue = headers[retryAfterHeader];
                      const duration = parseInt(String(retryAfterHeaderValue)) * 1000;
                      if (Number.isNaN(duration)) {
                        log.error(
                          { retryAfterHeader, retryAfterHeaderValue, headers },
                          `GitHub response header "${retryAfterHeader}" could not be parsed as seconds`,
                        );
                      } else {
                        return duration;
                      }
                    } else if (
                      /*
            If this is an API Rate Limit response error and we
            haven't been able to parse the precise required wait
            duration, it's not sane to try to recover from this
            error by using a fallback wait duration because it might
            be imprecise
          */
                      !isApiRateLimitResponse
                    ) {
                      log.info(
                        { headers, fallbackWaitDuration, message },
                        "Falling back to default wait duration since other heuristics were not fulfilled",
                      );
                      return fallbackWaitDuration;
                    }
                  })();

            if (waitDuration === undefined) {
              return new Err(error);
            }

            log.debug({}, `Waiting for ${waitDuration}ms until requests can be made again...`);
            await millisecondsDelay(waitDuration);
          }
        }
      } catch (error) {
        return new Err(error);
      }
    });

    /*
      3600 (seconds in an hour) / 5000 (requests limit) = 0.72, or 720
      milliseconds, which is the minimum value we can use for this delay
    */
    requestDelay = millisecondsDelay(768);

    if (result instanceof Err) {
      throw result.value;
    } else if (result === undefined) {
      throw new Error(`Unable to fetch GitHub response within ${triesCount} tries`);
    }

    return result.value;
  });

  const extendedOctokit = octokit as ExtendedOctokit;
  extendedOctokit[wasOctokitExtendedByApplication] = true;
  return extendedOctokit;
};

export type Comment = {
  status: number;
  id: number;
  htmlUrl: string;
  data: unknown | null; // TODO: quite a complex type inside
};
export const createComment = async (
  { disablePRComment, logger: log }: Context,
  octokit: Octokit,
  ...args: Parameters<typeof octokit.issues.createComment>
): Promise<Comment> => {
  if (disablePRComment) {
    log.info({ call: "createComment", args }, "createComment");
    return { status: 201, id: 0, htmlUrl: "", data: null };
  } else {
    const { data, status } = await octokit.issues.createComment(...args);
    return { status, id: data.id, htmlUrl: data.html_url, data };
  }
};

export const updateComment = async (
  { disablePRComment, logger: log }: Context,
  octokit: Octokit,
  ...args: Parameters<typeof octokit.issues.updateComment>
): Promise<void> => {
  if (disablePRComment) {
    log.info({ call: "updateComment", args }, "createComment");
  } else {
    await octokit.issues.updateComment(...args);
  }
};

export const reactToComment = async (
  ctx: Context,
  octokit: Octokit,
  ...args: Parameters<typeof octokit.reactions.createForIssueComment>
): Promise<number | undefined> => {
  const response = await octokit.reactions.createForIssueComment(...args);

  if (response.status === 201) {
    return response.data.id;
  } else {
    ctx.logger.error(response, `reactToComment response unsuccessful`);
  }
};

export const removeReactionToComment = async (
  ctx: Context,
  octokit: Octokit,
  ...args: Parameters<typeof octokit.reactions.deleteForIssueComment>
): Promise<void> => {
  const response = await octokit.reactions.deleteForIssueComment(...args);

  if (response.status !== 204) {
    ctx.logger.error(response, `reactToComment response unsuccessful`);
  }
};

export const cleanComments = async (
  ctx: Context,
  octokit: Octokit,
  originalComment: IssueComment,
  isAll: boolean,
  ...args: Parameters<typeof octokit.issues.listComments>
): Promise<void> => {
  if (ctx.disablePRComment) {
    ctx.logger.info({ call: "cleanComments", args }, "cleanComments");
  } else {
    const limit = 100;
    const params = args[0];

    if (params) {
      const botCommentIds = [];
      let stopped = false;
      params.page = 1;
      params.per_page = limit;

      while (!stopped) {
        const response = await octokit.issues.listComments(params);
        /* https://docs.github.com/en/rest/issues/comments?apiVersion=2022-11-28#list-issue-comments
           if there's more than LIMIT comments, github doesn't provide a total comments number,
           so we need to query all, until we reach the end */
        if (response.status === 200) {
          // check if we got enough comments
          if (response.data.length < limit) {
            // if enough, then stop this
            stopped = true;
            ctx.logger.debug(null, "cleanComments: stop paging");
          } else {
            // not enough: add +1 page to params
            params.page = params.page + 1;
            ctx.logger.debug(null, `cleanComments: increase page ${params.page}`);
          }
          const filteredComments = response.data
            .filter((comment) => {
              const isBot = comment.user?.type === "Bot";
              // to avoid deleting the original comment
              const isOriginalComment = comment.id === originalComment.id;
              // testing each comment with real commander and pulling repos (even cached) is quite expensive
              // so we just check if comment has the command pattern, assuming that if it includes pattern, it's a request to bot
              const commandPattern = new RegExp(`^${config.botPullRequestCommentMention} .*$`, "i");
              const hasCommand = comment.body?.split("\n").find((line) => commandPattern.test(line));
              return (isBot || (isAll && hasCommand)) && !isOriginalComment;
            })
            .map((comment) => comment.id);

          botCommentIds.push(...filteredComments);
        } else {
          ctx.logger.error(response, "cleanComments: listComments ended up with error");
          stopped = true;
        }
      }

      ctx.logger.debug(botCommentIds, "cleanComments: collected bot comment ids");

      if (botCommentIds.length) {
        for (const id of botCommentIds) {
          await deleteIssueComment(ctx, octokit, { id, repo: params.repo, owner: params.owner });
        }
      } else {
        ctx.logger.info(null, "no comments to clean");
      }
    } else {
      throw new Error("Parameters should be provided to clean comments");
    }
  }
};

async function deleteIssueComment(
  ctx: Context,
  octokit: Octokit,
  params: { id: number; repo: string; owner: string },
): Promise<void> {
  const { id, repo, owner } = params;
  const deleteResponse = await octokit.issues.deleteComment({ comment_id: id, repo, owner });

  if (deleteResponse.status !== 204) {
    ctx.logger.error(deleteResponse, `Failed to clean comment`);
  }
}

export const isOrganizationMember = async ({
  organizationId,
  username,
  octokit,
  logger: log,
}: {
  organizationId: number;
  username: string;
  octokit: ExtendedOctokit;
  logger: Logger;
}): Promise<boolean> => {
  try {
    const response = await octokit.orgs.userMembershipByOrganizationId({ organization_id: organizationId, username });
    return (response.status as number) === 204;
  } catch (error) {
    if (error instanceof RequestError) {
      /*
        error class is expected to be of RequestError or some variant which
        includes the failed HTTP status
        404 is one of the expected responses for this endpoint so this scenario
        doesn't need to be flagged as an error
      */
      if (error?.status !== 404) {
        log.fatal(error, "Organization membership API call responded with unexpected status code");
      }
    } else {
      log.fatal(error, "Caught unexpected error in isOrganizationMember");
    }
    return false;
  }
};

export const getPostPullRequestResult =
  (ctx: Context, octokit: Octokit, task: PullRequestTask): ((result: CommandOutput) => Promise<void>) =>
  async (result: CommandOutput) => {
    const { logger: log } = ctx;
    try {
      log.info({ result, task }, "Posting pull request result");

      const {
        gitRef: { upstream, prNumber },
        requester,
        command,
      } = task;

      await createComment(ctx, octokit, {
        owner: upstream.owner,
        repo: upstream.repo,
        issue_number: prNumber,
        body: `@${requester} Command \`${command}\` has finished. Result: ${
          typeof result === "string" ? result : `\n\`\`\`\n${displayError(result)}\n\`\`\`\n`
        }`,
      });
    } catch (error) {
      log.error({ error, result, task }, "Caught error while trying to post pull request result");
    }
  };
