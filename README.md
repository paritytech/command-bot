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
- [Developing](#developing)
  - [Running locally](#running-locally)
- [Configuration](#configuration)
  - [Environment variables](#configuration-environment-variables)
  - [GitHub App Settings](#configuration-github-app-settings)

# Pull request commands <a name="pull-request-commands"></a>

## Queue <a name="pull-request-command-queue"></a>

Comment in a pull request:

`/try-runtime queue [env_vars] --url ws://{kusama,westend,polkadot} [args]`

For instance (note that the following arguments might be outdated; this is
merely an example):

`/try-runtime queue RUST_LOG=debug --url ws://kusama --block-at "0x0" on-runtime-upgrade live`

Then the try-runtime Substrate CLI command will be ran for your pull request's
branch with the provided arguments and post the result as a comment. It's
supposed to support the same arguments as
[try-runtime](https://github.com/paritytech/substrate/blob/master/utils/frame/try-runtime/cli/src/lib.rs)
although not all of them have been tried out as of this writing.

Note: you **need to** refer to the nodes by their name e.g. `ws://polkadot`
instead of using arbitrary addresses directly.

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
