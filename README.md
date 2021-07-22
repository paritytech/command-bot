# try-runtime-bot

Note: This bot is not currently live.

# Usage

Comment in a pull request:

`/try-runtime queue [env_vars] live ws://{kusama,westend,rococo,polkadot} [args]`

For instance:

`/try-runtime queue RUST_LOG=debug live ws://kusama`

This will run the try-runtime Substrate feature for your pull request's branch
with the provided arguments and post the result as a comment. It's supposed to
support the same arguments as
[try-runtime](https://github.com/paritytech/substrate/blob/master/utils/frame/try-runtime/cli/src/lib.rs)
although not all of them have been tried out as of this writing.

# Running

1. [Configure your environment](https://github.com/paritytech/try-runtime-bot#configuration)
2. Install dependencies: `yarn`
3. Build: `yarn build`
4. Start: `yarn start`

References:

- [Dockerfile](https://github.com/paritytech/try-runtime-bot/blob/master/Dockerfile)
- [Scripts on package.json](https://github.com/paritytech/try-runtime-bot/blob/master/package.json)

# Developing

`yarn watch` is recommended because it will restart the server when the source
code changes. You'll want to copy [the example file](./env/bot.example.js) to
`./env/bot.js` and set the values there for this command to work.

---

For the scraping the servers locally, there's no need to compile the Polkadot
binaries by yourself. Simply run the image:

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

`DB_PATH`

Data is stored as a key-value on-disk database with RocksDB. `DB_PATH` should
point to a folder where the database files will be stored.

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

On production, it's recommended to set `LOG_FORMAT` to `json` so that
[Probot logs are output with structure](https://probot.github.io/docs/logging/#log-formats)
which is handy for querying in your logging aggregator.

## Github Settings

### Repository permissions

- Metadata: Read-only
- Issues: Read-only
- Pull Requests: Read & write

### Organization permissions

- Members: Read-only

### Event subscriptions

- Issue comment
