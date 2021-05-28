import assert from "assert"
import { Probot, run } from "probot"

assert(process.env.PRIVATE_KEY_BASE64)
process.env.PRIVATE_KEY = Buffer.from(
  process.env.PRIVATE_KEY_BASE64,
  "base64",
).toString()
assert(process.env.PRIVATE_KEY)
assert(process.env.APP_ID)
assert(process.env.WEBHOOK_SECRET)
assert(process.env.CLIENT_ID)
assert(process.env.CLIENT_SECRET)

const main = async function (bot: Probot) {
  console.log(bot)
}

run(main)
