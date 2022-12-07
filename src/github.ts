import { OctokitResponse } from "@octokit/plugin-paginate-rest/dist-types/types"
import { RequestError } from "@octokit/request-error"
import { EndpointInterface, Endpoints, RequestInterface } from "@octokit/types"
import { Mutex } from "async-mutex"
import { Probot } from "probot"

import { logger } from "./logger"
import { PullRequestTask } from "./task"
import { CommandOutput, Context } from "./types"
import { displayError, Err, millisecondsDelay, Ok } from "./utils"

type Octokit = Awaited<ReturnType<Probot["auth"]>>

const wasOctokitExtendedByApplication = Symbol()

export type ExtendedOctokit = Octokit & {
  orgs: Octokit["orgs"] & {
    userMembershipByOrganizationId: {
      (params: { organization_id: number; username: string }): Promise<
        Endpoints["GET /orgs/{org}/members/{username}"]["response"]
      >
      defaults: RequestInterface["defaults"]
      endpoint: EndpointInterface<{
        url: string
      }>
    }
  }
  [wasOctokitExtendedByApplication]: boolean
}

// Funnel all GitHub requests through a Mutex in order to avoid rate limits
const requestMutex = new Mutex()
let requestDelay = Promise.resolve()

const rateLimitRemainingHeader = "x-ratelimit-remaining"
const rateLimitResetHeader = "x-ratelimit-reset"
const retryAfterHeader = "retry-after"
export const getOctokit = (octokit: Octokit): ExtendedOctokit => {
  /*
    Check that this Octokit instance has not been augmented before because
    side-effects of this function should not be stacked; e.g. registering
    request wrappers more than once will break the application
  */
  if ((octokit as ExtendedOctokit)[wasOctokitExtendedByApplication]) {
    return octokit as ExtendedOctokit
  }

  Object.assign(octokit.orgs, {
    userMembershipByOrganizationId: octokit.request.defaults({
      method: "GET",
      url: "/organizations/:organization_id/members/:username",
    }),
  })

  octokit.hook.wrap("request", async (request, options) => {
    logger.info({ request, options }, "Preparing to send a request to the GitHub API")

    let triesCount = 0
    /* FIXME to get a good return type here, the function should be split.
         Will do in later iterations, or more likely,
         will drop whole file in favour of a shared module
         @see https://github.com/paritytech/opstooling/issues/117 */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: Ok<OctokitResponse<any>> | Err<any> | undefined = await requestMutex.runExclusive(async () => {
      try {
        await requestDelay

        for (; triesCount < 3; triesCount++) {
          if (triesCount) {
            logger.info(`Retrying Octokit request (tries so far: ${triesCount})`)
          }

          try {
            return new Ok(await request(options))
          } catch (error) {
            if (!(error instanceof RequestError)) {
              return new Err(error)
            }

            const { status, message } = error
            logger.error(
              `Error while querying GitHub API: url: ${error.request.url}, status: ${status}, message: ${message}`,
            )
            const isApiRateLimitResponse = message.startsWith("You have exceeded a secondary rate limit.")
            /*
              4XX status codes indicates a "client error", thus we assume the
              request is invalid and therefore there's no point in retrying it
              */
            if (!isApiRateLimitResponse && status >= 400 && status < 500) {
              return new Err(error)
            }

            const { response } = error
            const fallbackWaitDuration = 1000
            const waitDuration =
              response === undefined
                ? /*
                    We don't know what to make of this error since its response is
                    empty, so just use a fallback wait duration
                  */ fallbackWaitDuration
                : (() => {
                    const { headers } = response
                    if (parseInt(headers[rateLimitRemainingHeader] ?? "") === 0) {
                      // https://docs.github.com/en/rest/overview/resources-in-the-rest-api#rate-limit-http-headers
                      logger.warn(
                        `GitHub API limits were hit! The "${rateLimitResetHeader}" response header will be read to figure out until when we're supposed to wait...`,
                      )
                      const rateLimitResetHeaderValue = headers[rateLimitResetHeader]
                      const resetEpoch = parseInt(rateLimitResetHeaderValue ?? "") * 1000
                      if (Number.isNaN(resetEpoch)) {
                        logger.error(
                          { rateLimitResetHeaderValue, rateLimitResetHeader, headers },
                          `GitHub response header "${rateLimitResetHeader}" could not be parsed as epoch`,
                        )
                      } else {
                        const currentEpoch = Date.now()
                        const duration = resetEpoch - currentEpoch
                        if (duration < 0) {
                          logger.error(
                            { rateLimitResetHeaderValue, resetEpoch, currentEpoch, headers },
                            `Parsed epoch value for GitHub response header "${rateLimitResetHeader}" is smaller than the current date`,
                          )
                        } else {
                          return duration
                        }
                      }
                    } else if (headers[retryAfterHeader] !== undefined) {
                      // https://docs.github.com/en/rest/guides/best-practices-for-integrators#dealing-with-secondary-rate-limits
                      const retryAfterHeaderValue = headers[retryAfterHeader]
                      const duration = parseInt(String(retryAfterHeaderValue)) * 1000
                      if (Number.isNaN(duration)) {
                        logger.error(
                          { retryAfterHeader, retryAfterHeaderValue, headers },
                          `GitHub response header "${retryAfterHeader}" could not be parsed as seconds`,
                        )
                      } else {
                        return duration
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
                      logger.info(
                        { headers, fallbackWaitDuration, message },
                        "Falling back to default wait duration since other heuristics were not fulfilled",
                      )
                      return fallbackWaitDuration
                    }
                  })()

            if (waitDuration === undefined) {
              return new Err(error)
            }

            logger.info(`Waiting for ${waitDuration}ms until requests can be made again...`)
            await millisecondsDelay(waitDuration)
          }
        }
      } catch (error) {
        return new Err(error)
      }
    })

    /*
      3600 (seconds in an hour) / 5000 (requests limit) = 0.72, or 720
      milliseconds, which is the minimum value we can use for this delay
    */
    requestDelay = millisecondsDelay(768)

    if (result instanceof Err) {
      throw result.value
    } else if (result === undefined) {
      throw new Error(`Unable to fetch GitHub response within ${triesCount} tries`)
    }

    return result.value
  })

  const extendedOctokit = octokit as ExtendedOctokit
  extendedOctokit[wasOctokitExtendedByApplication] = true
  return extendedOctokit
}

export type Comment = {
  status: number
  id: number
  htmlUrl: string
  data: unknown | null // TODO: quite a complex type inside
}
export const createComment = async (
  { disablePRComment }: Context,
  octokit: Octokit,
  ...args: Parameters<typeof octokit.issues.createComment>
): Promise<Comment> => {
  if (disablePRComment) {
    logger.info({ call: "createComment", args })
    return { status: 201, id: 0, htmlUrl: "", data: null }
  } else {
    const { data, status } = await octokit.issues.createComment(...args)
    return { status, id: data.id, htmlUrl: data.html_url, data }
  }
}

export const updateComment = async (
  { disablePRComment }: Context,
  octokit: Octokit,
  ...args: Parameters<typeof octokit.issues.updateComment>
): Promise<void> => {
  if (disablePRComment) {
    logger.info({ call: "updateComment", args })
  } else {
    await octokit.issues.updateComment(...args)
  }
}

export const isOrganizationMember = async ({
  organizationId,
  username,
  octokit,
}: {
  organizationId: number
  username: string
  octokit: ExtendedOctokit
}): Promise<boolean> => {
  try {
    const response = await octokit.orgs.userMembershipByOrganizationId({ organization_id: organizationId, username })
    return (response.status as number) === 204
  } catch (error) {
    if (error instanceof RequestError) {
      /*
        error class is expected to be of RequestError or some variant which
        includes the failed HTTP status
        404 is one of the expected responses for this endpoint so this scenario
        doesn't need to be flagged as an error
      */
      if (error?.status !== 404) {
        logger.fatal(error, "Organization membership API call responded with unexpected status code")
      }
    } else {
      logger.fatal(error, "Caught unexpected error in isOrganizationMember")
    }
    return false
  }
}

export const getPostPullRequestResult =
  (ctx: Context, octokit: Octokit, task: PullRequestTask): ((result: CommandOutput) => Promise<void>) =>
  async (result: CommandOutput) => {
    try {
      logger.info({ result, task }, "Posting pull request result")

      const {
        gitRef: { upstream, prNumber },
        requester,
        command,
      } = task

      await createComment(ctx, octokit, {
        owner: upstream.owner,
        repo: upstream.repo,
        issue_number: prNumber,
        body: `@${requester} Command \`${command}\` has finished. Result: ${
          typeof result === "string" ? result : `\n\`\`\`\n${displayError(result)}\n\`\`\`\n`
        }`,
      })
    } catch (error) {
      logger.error({ error, result, task }, "Caught error while trying to post pull request result")
    }
  }
