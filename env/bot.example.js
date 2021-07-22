// Set the secrets and then rename this file to bot.js (it's ignored by default)

const fs = require("fs")
const path = require("path")

// All variables are required unless explicitly told otherwise.

/*
  The following variables can acquired from https://github.com/settings/apps/[app-name].
*/
process.env.WEBHOOK_SECRET =
  process.env.WEBHOOK_SECRET || "87aaaef9ca4b24d0828ed88f8c738ba86g448877"
process.env.APP_ID = process.env.APP_ID || 114992
process.env.CLIENT_ID = process.env.CLIENT_ID || "Iv1.36b4ff1b0716cc4e"
process.env.CLIENT_SECRET =
  process.env.CLIENT_SECRET || "33c62a84d21bbfb11494c2eb34e2df73bb628b19"

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
  Set up the Websocket address for all Polkadot runtime flavors.
*/
process.env.ROCOCO_WEBSOCKET_ADDRESS =
  process.env.ROCOCO_WEBSOCKET_ADDRESS || "0.0.0.0:9944"
process.env.POLKADOT_WEBSOCKET_ADDRESS =
  process.env.POLKADOT_WEBSOCKET_ADDRESS || "0.0.0.0:9944"
process.env.KUSAMA_WEBSOCKET_ADDRESS =
  process.env.KUSAMA_WEBSOCKET_ADDRESS || "0.0.0.0:9944"
process.env.WESTEND_WEBSOCKET_ADDRESS =
  process.env.WESTEND_WEBSOCKET_ADDRESS || "0.0.0.0:9944"

/*
  The 'db' directory is ignored on version control.
*/
process.env.DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "db")

//process.env.ALLOWED_ORGANIZATIONS = //process.env.ALLOWED_ORGANIZATIONS || "14176906"

/*
  NOT REQUIRED
  Set `POST_COMMENT` to "false" in order to have the bot log to the console
  instead of creating comments on the API. Useful while you're trying something
  out in order to avoid spamming pull requests with useless comments.
*/
//process.env.POST_COMMENT = //process.env.POST_COMMENT || "false"

/*
  NOT REQUIRED
  Probot has builtin smee.io integration. The webhook proxy url should be set
  to the smee.io URL in https://github.com/settings/apps/[app-name].
*/
// process.env.WEBHOOK_PROXY_URL ??= "https://smee.io/fc8OfV07M1O69fm5"
