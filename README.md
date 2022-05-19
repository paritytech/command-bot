# Introduction

command-bot provides interfaces for executing arbitrary commands on GitLab CI.

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

command-bot executes arbitrary commands on GitLab CI from
[commands in pull request comments](#pull-request-commands) (the
[GitHub App](#github-app) has to be installed in the repository) and from
[API requests](#api).

# Pull request commands <a name="pull-request-commands"></a>

## Queue <a name="pull-request-command-queue"></a>

Comment in a pull request:

`/cmd queue [bot-args] $ [args]`

In `[bot-args]` you should provide the following options

- `-c` / `--configuration`: select one of the following configurations
  - `bench-bot`: runs
    [`bench-bot`](https://github.com/paritytech/pipeline-scripts/blob/master/bench-bot.sh)
    `[args]`
  - `try-runtime`: runs
    `cargo run --release --quiet --features=try-runtime try-runtime [args]`. Note
    that you can use
    [the dedicated internal RPC nodes](https://github.com/paritytech/devops/wiki/Internal-RPC-nodes)
    in the arguments of this command.

- `-v` / `--var` (optional): defines environment variables for the CI job which
  runs the command. You can specify this option multiple times for multiple
  variables.

### Example

`/cmd queue -v RUST_LOG=debug -c bench-bot $ runtime westend-dev pallet_balances`

## Cancel <a name="pull-request-command-cancel"></a>

In the pull request where you previously ran `/cmd queue`, comment:

`/cmd cancel`

# API <a name="api"></a>

The API provides an alternative interface for executing commands directly
without having to go through pull request comments.

## Create a Personal Token <a name="api-create-token"></a>

For interacting with the commands, first a Personal Token needs to be generated
through `POST /api/access` by the
[`$MASTER_TOKEN`](#setup-environment-variables) (it is currently owned
by the OpsTooling team of Parity for Parity's deployments).

Each Personal Token is tied to a Matrix Room ID where the command's outcome will
be posted to after it finishes.

```sh
curl \
  -H "X-Auth: $MASTER_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST http://command-bot/access \
  -d '{
    "matrixRoom": "!tZrvvMzoIkIYbCkLuk:matrix.foo.io",
  }'
```

## Queue <a name="api-command-queue"></a>

Use a [Personal Token](#api-create-token) for queueing a command through `POST
/api/queue`:

```sh
curl \
  -H "X-Auth: $token" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -X POST http://command-bot/api/queue \
  -d '{
    "configuration": "bench-bot",
    "args": ["runtime", "westend-dev", "pallet_balances"],
    "variables": {
      "RUST_LOG": "info"
    },
    "gitRef": {
      "contributor": {
        "owner": "user",
        "repo": "substrate",
        "branch": "benchmarking-test"
      },
      "upstream": {
        "owner": "paritytech",
        "repo": "substrate"
      }
    }
  }'
```

## Cancel <a name="api-command-cancel"></a>

`POST /api/queue` will return a `{ task: { id: string } }` response. The
`task.id` can used for cancelling an ongoing command through `DELETE
/api/task/:task_id`.

```sh
curl \
  -H "X-Auth: $token" \
  -H "Content-Type: application/json" \
  -X DELETE http://command-bot/api/task/${TASK_ID}
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
- RocksDB's build requirements
  - Please check the [generateDockerfile](./scripts/generateDockerfile) for the
    relevant packages

## Environment variables <a name="setup-environment-variables"></a>

All environment variables are documented in the
[.env.example.cjs](./.env.example.cjs) file. For development you're welcome to
copy that file to `.env.cjs` so that all values will be loaded automatically
once the application starts.

# Development <a name="development"></a>

## Run the application <a name="development-run"></a>

1. [Set up the GitHub App](#github-app)
2. [Set up the application](#setup)

    During development it's handy to use a [smee.io](https://smee.io/) proxy,
    through the `WEBHOOK_PROXY_URL` environment variable, for receiving GitHub
    Webhook Events in your local server instance.

3. [Install the GitHub app](#github-app-installation) in a GitHub repository
4. Set up a GitLab repository in [`$GITLAB_PUSH_NAMESPACE`](./.env.example.cjs)
  to run the commands for the GitHub repository (Step 3)

    The GitLab repository name should match how the repository is named on
    GitHub.

5. Run `yarn` to install the dependencies
6. Run `yarn dev` to start a development server or `yarn watch` for a
  development server which automatically restarts when you make changes to the
  source files
7. Trigger the [commands](#pull-request-commands) in the repositories where
  you've installed the GitHub App (Step 3) and check if it works

  The `sample` configuration is available for debugging purposes

  `/cmd queue -c sample $ hi` will run `echo hi` in a GitLab job (repository
  from Step 4)

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

TODO: Update this to reflect command-bot refactor.

**Step 3**: Get the result

[Take the result](https://github.com/paritytech/try-runtime-bot/blob/68bffe556bc0fe91425dda31a542ba8fee71711d/src/executor.ts#L615)
from the
[command's execution](https://github.com/paritytech/try-runtime-bot/blob/68bffe556bc0fe91425dda31a542ba8fee71711d/src/executor.ts#L94) and
[post it as a pull request comment](https://github.com/paritytech/try-runtime-bot/blob/68bffe556bc0fe91425dda31a542ba8fee71711d/src/github.ts#L151)
if it originated from a pull request comment or
[send it to a Matrix room](https://github.com/paritytech/try-runtime-bot/blob/412e82d728798db0505f6f9dd622805a4ca43829/src/utils.ts#L187) if it originated from an API request.
