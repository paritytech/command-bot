// Set the secrets and then rename this file to bot.js (it's ignored by default)

const fs = require("fs")
const path = require("path")

/*
  Probot has builtin smee.io integration. The webhook proxy url should be set
  to the smee.io URL in https://github.com/settings/apps/[app-name].
*/
// process.env.WEBHOOK_PROXY_URL ??= "https://smee.io/fc8OfV07M1O69fm5"

/*
  The following variables can acquired from https://github.com/settings/apps/[app-name].
*/
process.env.WEBHOOK_SECRET ??= "87aaaef9ca4b24d0828ed88f8c738ba86g448877"
process.env.APP_ID ??= 114992
process.env.CLIENT_ID ??= "Iv1.36b4ff1b0716cc4e"
process.env.CLIENT_SECRET ??= "33c62a84d20fbfb11494c2eb34e2bb73bb628b19"

/*
  This private key's file can be generated and downloaded from https://github.com/settings/apps/[app-name].
*/
process.env.PRIVATE_KEY_BASE64 ??= Buffer.from(
  fs.readFileSync(path.join(__dirname, "..", "githubPrivateKey.pem"), "utf-8"),
).toString("base64")
