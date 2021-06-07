import { RequestError } from "@octokit/request-error"
import { Octokit } from "@octokit/rest"
import { EndpointInterface, Endpoints, RequestInterface } from "@octokit/types"

import { millisecondsDelay } from "./utils"

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
}

export const getOctokit = function (octokit: Octokit) {
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
      } catch (err) {
        result = err
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

  return octokit as ExtendedOctokit
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
  log,
}: {
  organizationId: number
  username: string
  octokit: ExtendedOctokit
  log: (str: string) => void
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
      log(
        `Organization membership API call responded with unexpected status code ${
          error?.status
        }\n${error?.stack ?? error?.message}`,
      )
    }
    return false
  }
}
