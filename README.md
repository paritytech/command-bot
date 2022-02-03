# try-runtime-bot

# Commands

## Queue

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

## Cancel

In the pull request where you previously ran `/try-runtime queue`, comment:

`/try-runtime cancel`

# API

Before triggering commands through the API, you'll need to an Access Token.
That token is registered through `POST /api/access` by the `MASTER_TOKEN`
(owned by the OpsTooling team of Parity) and will be tied to a Matrix room
ID where the command's output will be posted after it finishes. The token
can be invalidated at any point through `DELETE /api/access`.

Use the token in `POST /api/queue` for running a command and
`POST /api/cancel` for cancelling an ongoing command.

For the time being, arguments for those endpoints should be read from
[the API source](./src/api.ts), e.g. `validateQueueEndpointInput`, until the
[API documentation](https://github.com/paritytech/try-runtime-bot/issues/17) is done.

# Deploying

## Build and deploy

Either push a tag with the pattern `/^v-[0-9]+\.[0-9]+.*$/` or
[trigger a new pipeline](https://gitlab.parity.io/parity/opstooling/try-runtime-bot/-/pipelines/new)
with `BUILD` set to `production`.

## Only deploy

[Trigger a new pipeline](https://gitlab.parity.io/parity/opstooling/try-runtime-bot/-/pipelines/new)
with `DEPLOY` set to `production`.

# Running manually

1. [Configure your environment](https://github.com/paritytech/try-runtime-bot#configuration)
2. Install dependencies: `yarn`
3. Build: `yarn build`
4. Start: `yarn start`

References:

- [Dockerfile](https://github.com/paritytech/try-runtime-bot/blob/master/Dockerfile)
- [Scripts on package.json](https://github.com/paritytech/try-runtime-bot/blob/master/package.json)

# Developing

`yarn watch` is recommended because it will restart the server when the source
code changes. You'll want to copy [the example file](./env/bot.example.cjs) to
`./env/bot.cjs` and set the values there for this command to work.

Here's a Docker command you can use to set up a node for running `/try-runtime`
locally:

`docker run -p 9944:9944 parity/polkadot:v0.9.3 --base-path /polkadot --unsafe-rpc-external --unsafe-ws-external --rpc-cors all --chain kusama`

Note the `--chain` argument as it should be set to the specific runtime you're
targetting.

# Configuration

## Required environment variables

From the Github App settings:
  - `APP_ID`
  - `CLIENT_ID`
  - `CLIENT_SECRET`
  - `WEBHOOK_SECRET`
  - `PRIVATE_KEY_BASE64`
    - The Github Settings page will give you the private key as a `.pem` file
      in plain-text with newlines. This is inconvenient because Gitlab CI will
      not be able to protect the secret if it stays like that. Our workaround is
      to encrypt the key as Base64 before setting it up as a Gitlab CI
      variable. That means you'll have to encode manually: take the plain-text
      content from the `.pem` file and encode it as Base64 **without newlines**
      (on Linux this can be done with `base64 -w 0 file.pem`).

`DATA_PATH`

DATA_PATH should point to a folder where the program's persistent data, such
as the database,  will be stored.

`ALLOWED_ORGANIZATIONS`

Comma-delimited Github organization IDs whose members are allowed to run the
bot's commands. The ID can be fetched from the Github API by the organization's
username as `https://api.github.com/users/${organization}`, for instance
`https://api.github.com/users/paritytech` which will respond with:

```json
{
  "login": "paritytech",
  "id": 14176906,
}
```

**At least one organization ID has to be provided for the bot to work.**

## Optional environment variables

### Nodes

`{NAME}_WEBSOCKET_ADDRESS`

The addresses of nodes you'll be targetting (by name) in the commands; e.g. to
be able to use `ws://polkadot` in try-runtime's arguments, you'll have to
create a `POLKADOT_WEBSOCKET_ADDRESS` variable.

```
POLKADOT_WEBSOCKET_ADDRESS=ws://polkadot-node.io:9944
```

The application will automatically register node addresses for environment
variables following that pattern.

### API

Note: If the following variables are not set, then the API will be disabled,
but the bot will still be available for pull requests interactions only.

`MATRIX_HOMESERVER` and `MATRIX_ACCESS_TOKEN`

When an API command finishes, the bot will send a message on Matrix in the
room assigned to the requester's token.

`MASTER_TOKEN`

The token which allows granting access to other tokens through the API.

### Logging

On production, it's recommended to set `LOG_FORMAT` to `json` so that
[Probot logs are output with structure](https://probot.github.io/docs/logging/#log-formats)
which is handy for querying in your logging aggregator.

## Github Settings

### Repository permissions

- Metadata: Read-only
  - Automatically assigned
- Issues: Read-only
  - For interacting with the comments API
- Pull Requests: Read & write
  - For posting comments on pull requests
- Contents: Read-only
  - For cloning repositories

### Organization permissions

- Members: Read-only
  - Related to `ALLOWED_ORGANIZATIONS`: see if a user belongs to allowed
    organizations even if their membership is private
### Event subscriptions

- Issue comment
  - For reacting to pull request comments
