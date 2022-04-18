/* eslint-disable multiline-comment-style */

/*
  Set the appropriate values and rename this file to env.cjs (it's already
  .gitignore by default)
*/

const fs = require("fs")
const path = require("path")

/*

  Notes:
  - All variables are required unless explicitly told otherwise.
  - All values used for the variables are presented only for the sake of
    exemplifying what should be used in them. Read the description of each value
    in order to figure out how they should be provided.
*/

/*
  The following variables can acquired from https://github.com/settings/apps/[app-name].
  Guides:
    - https://docs.github.com/en/developers/apps/building-github-apps/creating-a-github-app
    - https://probot.github.io/docs/development/#manually-configuring-a-github-app
    - https://probot.github.io/docs/development/#installing-the-app-on-a-repository
*/
process.env.WEBHOOK_SECRET ??= "placeholder"
process.env.APP_ID ??= 123
process.env.CLIENT_ID ??= "placeholder"
process.env.CLIENT_SECRET ??= "placeholder"

/*
  This private key's file can be generated and downloaded from
  https://github.com/settings/apps/[app-name].
  If you need to calculate the Base64 of the value manually, that can be done
  with `base64 -w 0 private-key.pem`.
*/
process.env.PRIVATE_KEY_BASE64 ??= Buffer.from(
  fs.readFileSync(path.join(__dirname, "..", "githubPrivateKey.pem"), "utf-8"),
).toString("base64")

// The 'data' directory in this location is already ignored on version control
process.env.DATA_PATH ??= path.join(__dirname, "..", "data")

/*
  Comma-separated organizations whose members will be able to run the commands.
  At least one organization ID *has to* be provided for the bot to work.

  The ID for each organization can be figured out by making a request to
  https://api.github.com/users/$org.
*/
process.env.ALLOWED_ORGANIZATIONS ??= "123,456"

/*
  Any environment variable following the pattern `${NAME}_WEBSOCKET_ADDRESS`
  will be registered as a possible node target at the start of the application.
  For instance, if you define a `POLKADOT_WEBSOCKET_ADDRESS` it will be
  possible try use `ws://polkadot` in try-runtime's arguments.
*/
// process.env.POLKADOT_WEBSOCKET_ADDRESS ??= "ws://0.0.0.0:9944"
// process.env.KUSAMA_WEBSOCKET_ADDRESS ??= "ws://0.0.0.0:9945"
// process.env.WESTEND_WEBSOCKET_ADDRESS ??= "ws://0.0.0.0:9946"

/*
  NOT REQUIRED
  The API interactions needs a Matrix-related variables to be configured for
  notifying when a command finishes. Additionally, MASTER_TOKEN is used for
  allowing tokens to the API. If those are missing, then the API will not work.
*/
// process.env.MATRIX_HOMESERVER ??= "https://matrix.parity.io"
// process.env.MATRIX_ACCESS_TOKEN ??= "placeholder"
// process.env.MASTER_TOKEN ??= "placeholder"

/*
  NOT REQUIRED
  - For production it's recommended to set LOG_FORMAT to "json" so that log
  entries it can be queried easily.
  - For development it's recommended to leave this variable empty because the
  output should end up being more readable that way.
*/
// process.env.LOG_FORMAT ??= "json"

/*
  NOT REQUIRED
  Set `POST_COMMENT` to "false" in order to have the bot log to the console
  instead of creating comments on the API. Useful while you're trying something
  out in order to avoid spamming pull requests with useless comments.
*/
// process.env.POST_COMMENT ??= false

/*
  NOT REQUIRED
  Probot has builtin smee.io integration. The webhook proxy url should be set
  to the smee.io URL in https://github.com/settings/apps/[app-name].
*/
// process.env.WEBHOOK_PROXY_URL ??= "https://smee.io/fc8OfV07M1O69fm5"
