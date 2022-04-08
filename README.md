# Introduction

This bot provides interfaces for executing the
[try-runtime cli](https://github.com/paritytech/substrate/blob/master/utils/frame/try-runtime/cli/)
on a dedicated remote host.

Before starting to work on this project, we recommend reading the
[Implementation section](#implementation).

# TOC

- [How it works](#how-it-works)
- [Pull request commands](#pull-request-commands)
  - [Queue](#pull-request-command-queue)
  - [Cancel](#pull-request-command-cancel)
- [API](#api)
  - [Create a Personal Token](#api-create-token)
  - [Queue](#api-command-queue)
  - [Cancel](#api-command-cancel)
- [GitHub App](#github-app)
  - [Configuration](#github-app-configuration)
  - [Installation](#github-app-installation)
- [Setup](#setup)
  - [Requirements](#setup-requirements)
  - [Environment variables](#setup-environment-variables)
- [Development](#development)
  - [Run the application](#development-run)
- [Deployment](#deployment)
  - [Logs](#deployment-logs)
  - [Environments](#deployment-environments)
- [Implementation](#implementation)

# How it works <a name="how-it-works"></a>

This bot executes the
[try-runtime CLI](https://github.com/paritytech/substrate/blob/master/utils/frame/try-runtime/cli)
from [commands in pull request comments](#pull-request-commands) (the
[GitHub App](#github-app) has to be installed in the repository) and from
[API requests](#api).

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
[`$MASTER_TOKEN`](#setup-environment-variables) (it is currently owned
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

# GitHub App <a name="github-app"></a>

The GitHub App is necessary for the application to receive
[webhook events](https://probot.github.io/docs/webhooks) and
access the GitHub API properly.

Follow the instructions of
<https://gitlab.parity.io/groups/parity/opstooling/-/wikis/Bots/Development/Create-a-new-GitHub-App>
for creating a new GitHub App.

After creating the app, you should [configure](#github-app-configuration) and
[install it](#github-app-installation) (make sure the
[environment](#setup-environment-variables) is properly set up before using it).

## Configuration <a name="github-app-configuration"></a>

Configuration is done at `https://github.com/settings/apps/${APP}/permissions`.

### Repository permissions

- Issues: Read-only
  - Allows for interacting with the comments API
- Pull Requests: Read & write
  - Allows for posting comments on pull requests
- Contents: Read-only
  - Allows for cloning repositories before running commands

### Organization permissions

- Members: Read-only
  - Related to [`$ALLOWED_ORGANIZATIONS`](#setup-environment-variables):
    this permission enables the bot to request the organization membership of
    the command's requester even if their membership is private

### Event subscriptions

- Issue comment
  - Allows for receiving events for pull request comments

## Installation <a name="github-app-installation"></a>

Having [created](#github-app) and [configured](#github-app-configuration) the
GitHub App, install it in a repository through
`https://github.com/settings/apps/${APP}/installations`.

# Setup <a name="setup"></a>

## Requirements <a name="setup-requirements"></a>

- Node.js for running the application
- `yarn` for installing packages and running scripts
  - If it's not already be bundled with Node.js, install with
    `npm install -g yarn`
- `git` for cloning branches before executing try-runtime-cli
- Rust for being able to build the try-runtime-cli
  - [rustup](https://rustup.rs/) is the recommended way of setting up a Rust
    toolchain
- try-runtime-cli's build requirements
  - Please check the [generateDockerfile](./scripts/generateDockerfile) for the
    relevant packages
- RocksDB's build requirements
  - Please check the [generateDockerfile](./scripts/generateDockerfile) for the
    relevant packages

## Environment variables <a name="setup-environment-variables"></a>

All environment variables are documented in the
[env/bot.example.cjs](./env/bot.example.cjs) file. For development you're
welcome to copy that file to `env/bot.cjs` so that all values will be loaded
automatically once the application starts.

# Development <a name="development"></a>

## Run the application <a name="development-run"></a>

1. [Set up the GitHub App](#github-app)
2. [Set up the application](#setup)

    During development it's handy to use a [smee.io](https://smee.io/) proxy,
    through the `WEBHOOK_PROXY_URL` environment variable, for receiving GitHub
    Webhook Events in your local server instance.

3. Set up the blockchain nodes

    The following command can be used to set up a blockchain node locally (for usage
    in [`${NAME}_WEBSOCKET_ADDRESS`](#setup-environment-variables)):

    `docker run -p 9944:9944 parity/polkadot:latest --unsafe-rpc-external --unsafe-ws-external --ws-port 9944 --rpc-cors all --dev --tmp`

4. Run `yarn` to install the dependencies
5. Run `yarn dev` to start a development server or `yarn watch` for a
  development server which automatically restarts when you make changes to the
  source files
6. Trigger the [commands](#pull-request-commands) in the repositories where
  you've installed the GitHub App (Step 2) and check if it works

# Deployment <a name="deployment"></a>

## Logs <a name="deployment-logs"></a>

See <https://gitlab.parity.io/groups/parity/opstooling/-/wikis>

## Environments <a name="deployment-environments"></a>

When you push a deployment tag to GitHub, it will be
[mirrored to GitLab](https://gitlab.parity.io/parity/opstooling/try-runtime-bot)
and then its [CI pipeline](./.gitlab-ci.yml) will be run for deploying the app.

The application can be deployed to the following environments:

- Production

  To build **and** deploy: Either push a tag with the pattern
  `/^v-[0-9]+\.[0-9]+.*$/` or
  [trigger a new pipeline](https://gitlab.parity.io/parity/opstooling/try-runtime-bot/-/pipelines/new)
  with `BUILD` set to `production`.

  To only deploy (an existing tag):
  [trigger a new pipeline](https://gitlab.parity.io/parity/opstooling/try-runtime-bot/-/pipelines/new)
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
