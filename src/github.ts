import { RequestError } from "@octokit/request-error"
import { EndpointInterface, Endpoints, RequestInterface } from "@octokit/types"

import { Logger } from "./logger"
import {
  CommandOutput,
  Octokit,
  PullRequestParams,
  PullRequestTask,
  State,
} from "./types"
import {
  displayError,
  getDeploymentLogsMessage,
  millisecondsDelay,
} from "./utils"

// The actual limit should be 65532 but we're a bit conservative here
// https://github.community/t/maximum-length-for-the-comment-body-in-issues-and-pr/148867/2
const githubCommentCharacterLimit = 65500

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
  extendedByTryRuntimeBot: boolean
}

export const getOctokit = function (octokit: Octokit): ExtendedOctokit {
  if ((octokit as ExtendedOctokit).extendedByTryRuntimeBot) {
    return octokit as ExtendedOctokit
  }

  Object.assign(octokit.orgs, {
    userMembershipByOrganizationId: octokit.request.defaults({
      method: "GET",
      url: "/organizations/:organization_id/members/:username",
    }),
  })

  octokit.hook.wrap("request", async function (request, options) {
    let result: any

    // throttle requests in order to avoid abuse limit
    await millisecondsDelay(500)

    for (let tryCount = 1; tryCount < 4; tryCount++) {
      try {
        result = await request(options)
      } catch (error) {
        result = error
      }

      if (
        !(result instanceof RequestError) ||
        [400, 401, 403, 404, 422].includes(result.status)
      ) {
        break
      }

      await millisecondsDelay(tryCount * 1000)
    }

    if (result instanceof Error) {
      throw result
    }

    return result
  })

  const extendedOctokit = octokit as ExtendedOctokit
  extendedOctokit.extendedByTryRuntimeBot = true
  return extendedOctokit
}

export const createComment = async function (
  octokit: Octokit,
  ...args: Parameters<typeof octokit.issues.createComment>
): Promise<{ status: number; id: number; data: any }> {
  if (process.env.POST_COMMENT === "false") {
    console.log({ call: "createComment", args })
    return { status: 201, id: 0, data: null }
  } else {
    const { data, status } = await octokit.issues.createComment(...args)
    return { status, id: data.id, data }
  }
}

export const updateComment = async function (
  octokit: Octokit,
  ...args: Parameters<typeof octokit.issues.updateComment>
) {
  if (process.env.POST_COMMENT === "false") {
    console.log({ call: "updateComment", args })
  } else {
    await octokit.issues.updateComment(...args)
  }
}

export const isOrganizationMember = async function ({
  organizationId,
  username,
  octokit,
  logger,
}: {
  organizationId: number
  username: string
  octokit: ExtendedOctokit
  logger: Logger
}) {
  try {
    const response = await octokit.orgs.userMembershipByOrganizationId({
      organization_id: organizationId,
      username,
    })
    return (response.status as number) === 204
  } catch (error) {
    // error class is expected to be of RequestError or some variant which
    // includes the failed HTTP status
    // 404 is one of the expected responses for this endpoint so this scenario
    // doesn't need to be flagged as an error
    if (error?.status !== 404) {
      logger.fatal(
        error,
        "Organization membership API call responded with unexpected status code",
      )
    }
    return false
  }
}

export const getPostPullRequestResult = function ({
  taskData,
  octokit,
  state: { logger, deployment },
}: {
  taskData: PullRequestTask
  octokit: Octokit
  state: Pick<State, "deployment" | "logger">
}) {
  return async function (result: CommandOutput) {
    try {
      logger.info({ result, taskData }, "Posting pull request result")

      const { owner, repo, requester, pull_number, commandDisplay } = taskData

      const before = `
@${requester} Results are ready for ${commandDisplay}

<details>
<summary>Output</summary>

\`\`\`
`

      const after = `
\`\`\`

</details>

`

      let resultDisplay =
        typeof result === "string" ? result : displayError(result)
      let truncateMessageWarning: string
      if (
        before.length + resultDisplay.length + after.length >
        githubCommentCharacterLimit
      ) {
        truncateMessageWarning = `\nThe command's output was too big to be fully displayed. ${getDeploymentLogsMessage(
          deployment,
        )}.`
        const truncationIndicator = "[truncated]..."
        resultDisplay = `${resultDisplay.slice(
          0,
          githubCommentCharacterLimit -
            (before.length +
              truncationIndicator.length +
              after.length +
              truncateMessageWarning.length),
        )}${truncationIndicator}`
      } else {
        truncateMessageWarning = ""
      }

      await createComment(octokit, {
        owner,
        repo,
        issue_number: pull_number,
        body: `${before}${resultDisplay}${after}${truncateMessageWarning}`,
      })
    } catch (error) {
      logger.fatal(
        { error, result, taskData },
        "Caught error while trying to post pull request result",
      )
    }
  }
}

export const getPullRequestHandleId = function ({
  owner,
  repo,
  pull_number,
}: PullRequestParams) {
  return `owner: ${owner}, repo: ${repo}, pull: ${pull_number}`
}
