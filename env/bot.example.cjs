// Set the secrets and then rename this file to bot.cjs (it's ignored by default)

const fs = require("fs")
const path = require("path")

// All variables are required unless explicitly told otherwise.

//process.env.ALLOWED_ORGANIZATIONS = process.env.ALLOWED_ORGANIZATIONS || "14176906"

/*
  The following variables can acquired from https://github.com/settings/apps/[app-name].
*/
process.env.WEBHOOK_SECRET =
  process.env.WEBHOOK_SECRET || "87aaeef4ca4b2cc0828ed88f8c738ba86g448877"
process.env.APP_ID = process.env.APP_ID || 114992
process.env.CLIENT_ID = process.env.CLIENT_ID || "Iv3.36aaff1b0716cc4e"
process.env.CLIENT_SECRET =
  process.env.CLIENT_SECRET || "33c62a84d21bbff11494c2ef34e2ff73bb628b19"

/*
  This private key's file can be generated and downloaded from https://github.com/settings/apps/[app-name].
*/
process.env.PRIVATE_KEY_BASE64 =
  process.env.PRIVATE_KEY_BASE64 ||
  Buffer.from(
    fs.readFileSync(
      path.join(__dirname, "..", "githubPrivateKey.pem"),
      "utf-8",
    ),
  ).toString("base64")

/*
  The 'data' directory in that location is already ignored on version control.
*/
process.env.DATA_PATH =
  process.env.DATA_PATH || path.join(__dirname, "..", "data")

/*
  NOT REQUIRED: API-related variables
  The API interactions needs a Matrix-related variables to be configured for
  notifying when a command finishes. Additionally, MASTER_TOKEN is used for
  allowing tokens to the API. If those are missing, then the API will not work.
*/
//process.env.MATRIX_HOMESERVER = "https://matrix.parity.io"
//process.env.MATRIX_ACCESS_TOKEN = "XXXXXXX"
//process.env.MASTER_TOKEN = "0"

/*
  NOT REQUIRED
  Set `POST_COMMENT` to "false" in order to have the bot log to the console
  instead of creating comments on the API. Useful while you're trying something
  out in order to avoid spamming pull requests with useless comments.
*/
//process.env.POST_COMMENT = process.env.POST_COMMENT || "false"

/*
  NOT REQUIRED
  Probot has builtin smee.io integration. The webhook proxy url should be set
  to the smee.io URL in https://github.com/settings/apps/[app-name].
*/
//process.env.WEBHOOK_PROXY_URL ??= "https://smee.io/fc8OfV07M1O69fm5"
