import assert from "assert"

import { ExtendedOctokit, isOrganizationMember } from "./github"
import { Context } from "./types"

export const parseTryRuntimeBotCommand = (
  commandLine: string,
  { baseEnv }: { baseEnv: Record<string, string> },
) => {
  const tokens = commandLine.split(" ").filter((value) => {
    return !!value
  })

  const envVars: { name: string; value: string }[] = []
  const command: string[] = []
  // envArgs are only collected at the start of the command line
  let isCollectingEnvVars = true
  while (true) {
    const token = tokens.shift()
    if (token === undefined) {
      break
    }

    if (isCollectingEnvVars) {
      const matches = token.match(/^([A-Za-z_]+)=(.*)/)
      if (matches === null) {
        isCollectingEnvVars = false
      } else {
        const [, name, value] = matches
        assert(name)
        envVars.push({ name, value })
        continue
      }
    }

    command.push(token)
  }

  const env: Record<string, string> = { ...baseEnv }
  for (const { name, value } of envVars) {
    env[name] = value
  }

  const [execPath, ...args] = command

  return { execPath, args, env }
}

// This expression catches the following forms: --foo, -foo, -foo=, --foo=
const optionPrefixExpression = /^-[^=\s]+[=\s]*/

// This expression catches the following forms: ws://foo, wss://foo, etc.
const uriPrefixExpression = /^ws\w*:\/\//

export const parseTryRuntimeBotCommandArgs = (
  { nodesAddresses }: Context,
  args: string[],
) => {
  const nodeOptionsDisplay = `Available names are: ${Object.keys(
    nodesAddresses,
  ).join(", ")}.`

  const parsedArgs = []
  for (const rawArg of args) {
    const optionPrefix = optionPrefixExpression.exec(rawArg)
    const { argPrefix, arg } =
      optionPrefix === null
        ? { argPrefix: "", arg: rawArg }
        : {
            argPrefix: optionPrefix[0],
            arg: rawArg.slice(optionPrefix[0].length),
          }

    const uriPrefixMatch = uriPrefixExpression.exec(arg)
    if (uriPrefixMatch === null) {
      parsedArgs.push(rawArg)
      continue
    }
    const [uriPrefix] = uriPrefixMatch

    const invalidNodeAddressExplanation = `Argument "${arg}" started with ${uriPrefix} and therefore it was interpreted as a node address, but it is invalid`

    const node = arg.slice(uriPrefix.length)
    if (!node) {
      return `${invalidNodeAddressExplanation}. Must specify one address in the form \`${uriPrefix}name\`. ${nodeOptionsDisplay}`
    }

    const nodeAddress = nodesAddresses[node]
    if (!nodeAddress) {
      return `${invalidNodeAddressExplanation}. Nodes are referred to by name. No node named "${node}" is available. ${nodeOptionsDisplay}`
    }

    parsedArgs.push(`${argPrefix}${nodeAddress}`)
  }

  return parsedArgs
}

export const getDeploymentsLogsMessage = ({ deployment }: Context) => {
  return deployment === undefined
    ? ""
    : `The logs for this command should be available on Grafana for the data source \`loki.${deployment.environment}\` and query \`{container=~"${deployment.container}"}\``
}

export const isRequesterAllowed = async (
  ctx: Context,
  octokit: ExtendedOctokit,
  username: string,
) => {
  const { allowedOrganizations } = ctx

  for (const organizationId of allowedOrganizations) {
    if (
      await isOrganizationMember(ctx, { organizationId, username, octokit })
    ) {
      return true
    }
  }

  return false
}
