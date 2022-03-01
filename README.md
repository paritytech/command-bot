# Introduction

This bot provides interfaces for executing the
[try-runtime cli](https://github.com/paritytech/substrate/blob/master/utils/frame/try-runtime/cli/)
on a dedicated remote host.

# TOC

- [Pull request commands](#pull-request-commands)
  - [Queue](#pull-request-command-queue)
  - [Cancel](#pull-request-command-cancel)
- [API](#api)
  - [Create a Personal Token](#api-create-token)
  - [Queue](#api-command-queue)
  - [Cancel](#api-command-cancel)
- [Deploying](#deploying)
  - [Build and deploy](#build-and-deploy)
  - [Only deploy](#only-deploy)
- [Implementation](#implementation)
- [Developing](#developing)
  - [Running locally](#running-locally)
- [Configuration](#configuration)
  - [Environment variables](#configuration-environment-variables)
  - [GitHub App Settings](#configuration-github-app-settings)

# Pull request commands <a name="pull-request-commands"></a>

## Queue <a name="pull-request-command-queue"></a>

Comment in a pull request:

`/try-runtime queue [env-vars] --url ws://[kusama | westend | polkadot] [try-runtime-cli-args]`

For instance:

`/try-runtime queue RUST_LOG=debug --url ws://kusama --block-at "0x0" on-runtime-upgrade live`

The `[try-runtime-cli-args]` form accepts the same arguments as the
[try-runtime CLI](https://github.com/paritytech/substrate/blob/master/utils/frame/try-runtime/cli/src/lib.rs)
except that you **need to** refer to the nodes by their name e.g.
`ws://polkadot` instead of using arbitrary addresses.

Upon receiving the event for that comment, try-runtime-bot will queue the
execution of the try-runtime CLI using the pull request's branch and post the
result (`stdout` for success or `stderr` for errors) as a pull request comment
when it finishes.

## Cancel <a name="pull-request-command-cancel"></a>

In the pull request where you previously ran `/try-runtime queue`, comment:

`/try-runtime cancel`

# API <a name="api"></a>

The API provides an alternative interface for executing commands directly
without having to go through pull request comments.

## Create a Personal Token <a name="api-create-token"></a>

For interacting with the commands, first a Personal Token needs to be registered
through `POST /api/access` by the
[`$MASTER_TOKEN`](#configuration-environment-variables) (it is currently owned
by the OpsTooling team of Parity for Parity's deployments).

Each Personal Token is tied to a Matrix Room ID where the command's output will
be posted to after it finishes.

```
curl \
  -H "X-Auth: $MASTER_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST http://try-runtime-bot/api/access \
  -d '{
    "token": "secret",
    "matrixRoom": "!tZrvvMzoIkIYbCkLuk:matrix.foo.io",
  }'
```

## Queue <a name="api-command-queue"></a>

Use a [Personal Token](#api-create-token) for queueing a command through `POST
/api/queue`:

```
curl \
  -H "X-Auth: $token" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -X POST http://try-runtime-bot/api/queue \
  -d '{
    "execPath": "cargo",
    "args": [
      "run",
      "--quiet",
      "--features=try-runtime",
      "try-runtime",
      "--block-at=0x5d67782862757220cb25cf073585f6a75a9031f1da4115e5cba1721c2c6e249c",
      "--url=ws://polkadot",
      "on-runtime-upgrade",
      "live"
    ],
    "gitRef": {
      "contributor": "paritytech",
      "owner": "paritytech",
      "repo": "substrate",
      "branch": "master"
    }
  }'
```

## Cancel <a name="api-command-cancel"></a>

`POST /api/queue` will return a `{ "handleId": string }` response which can be
used for cancelling an ongoing command through `POST /api/cancel`.

```
curl \
  -H "X-Auth: $token" \
  -H "Content-Type: application/json" \
  -X POST http://try-runtime/api/cancel \
  -d '{
    "handleId": "foo"
  }'
```

# Deploying <a name="deploying"></a>

## Build and deploy <a name="build-and-deploy"></a>

Either push a tag with the pattern `/^v-[0-9]+\.[0-9]+.*$/` or
[trigger a new pipeline](https://gitlab.parity.io/parity/opstooling/try-runtime-bot/-/pipelines/new)
with `BUILD` set to `production`.

## Only deploy <a name="only-deploy"></a>

[Trigger a new pipeline](https://gitlab.parity.io/parity/opstooling/try-runtime-bot/-/pipelines/new)
with `DEPLOY` set to `production`.

# Implementation <a name="implementation"></a>

**Step 1**: Create a Task for a command request

A request is turned into a
[task](https://github.com/paritytech/try-runtime-bot/blob/68bffe556bc0fe91425dda31a542ba8fee71711d/src/types.ts#L47)
either
[via API](https://github.com/paritytech/try-runtime-bot/blob/68bffe556bc0fe91425dda31a542ba8fee71711d/src/api.ts#L135) or
[through a pull request Webhook event](https://github.com/paritytech/try-runtime-bot/blob/68bffe556bc0fe91425dda31a542ba8fee71711d/src/webhook.ts#L269)
(which are delivered from GitHub
[as HTTP `POST` requests](https://probot.github.io/docs/webhooks/)).

**Step 2**: Queue the task

The task is
[saved to the database](https://github.com/paritytech/try-runtime-bot/blob/68bffe556bc0fe91425dda31a542ba8fee71711d/src/executor.ts#L551)
so that
[it will be retried later in case it can't be finished](https://github.com/paritytech/try-runtime-bot/blob/06a2d872c752f216dc890596e633112de99b6699/src/executor.ts#L640)
(e.g. due to a container restart or crash).

After being saved to the database, the task is
[queued through `mutex.runExclusive`](https://github.com/paritytech/try-runtime-bot/blob/68bffe556bc0fe91425dda31a542ba8fee71711d/src/executor.ts#L554).

Note: since execution of the task entails compiling the
[try-runtime cli](https://github.com/paritytech/substrate/blob/master/utils/frame/try-runtime/cli/),
which in turn entails compiling Substrate (or some other project based on
Substrate, such as Polkadot), the bot needs quite a lot of disk space since
those projects consume upwards of dozens of gigabytes per build. In this sense
the application also deeply cares about having enough space for running the
commands, as discussed in
https://github.com/paritytech/try-runtime-bot/issues/24#issuecomment-920737773.

**Step 3**: Get the result

[Take the result](https://github.com/paritytech/try-runtime-bot/blob/68bffe556bc0fe91425dda31a542ba8fee71711d/src/executor.ts#L615)
from the
[command's execution](https://github.com/paritytech/try-runtime-bot/blob/68bffe556bc0fe91425dda31a542ba8fee71711d/src/executor.ts#L94) and
[post it as a pull request comment](https://github.com/paritytech/try-runtime-bot/blob/68bffe556bc0fe91425dda31a542ba8fee71711d/src/github.ts#L151)
if it originated from a pull request comment or
[send it to a Matrix room](https://github.com/paritytech/try-runtime-bot/blob/412e82d728798db0505f6f9dd622805a4ca43829/src/utils.ts#L187) if it originated from an API request.

# Developing <a name="developing"></a>

Before developing you'll have to to copy
[the example environment file](./env/bot.example.cjs) to `./env/bot.cjs` and set
the appropriate values there.

## Running locally <a name="running-locally"></a>

1. [Configure your environment](#developing)
2. Install dependencies: `yarn install`
3. Start the application `yarn dev` for a static development server or `yarn
  watch` for a development server which automatically restarts when you make
  changes to the source files

The following command can be used to set up a blockchain node locally (for usage
in [`${NAME}_WEBSOCKET_ADDRESS`](#configuration-environment-variables)):

`docker run -p 9944:9944 parity/polkadot:latest --base-path /polkadot --unsafe-rpc-external --unsafe-ws-external --rpc-cors all --chain kusama`

Note the `--chain` argument as it should be set to the specific runtime you're
targetting.

# Configuration <a name="configuration"></a>

## Environment variables <a name="configuration-environment-variables"></a>

Please check [the environment example file](./env/bot.example.cjs) for the
explanation on all the required environment variables.

## GitHub App Settings <a name="configuration-github-app-settings"></a>

### Repository permissions

- Issues: Read-only
  - Allows for interacting with the comments API
- Pull Requests: Read & write
  - Allows for posting comments on pull requests
- Contents: Read-only
  - Allows for cloning repositories before running commands

### Organization permissions

- Members: Read-only
  - Related to [`$ALLOWED_ORGANIZATIONS`](#configuration-environment-variables):
    this permission enables the bot to request the organization membership of
    the command's requester even if their membership is private

### Event subscriptions

- Issue comment
  - Allows for receiving events for pull request comments
