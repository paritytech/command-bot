# try-runtime-bot

# Running

1. Install dependencies: `npm install`
2. Build: `npm run build`
3. Start: `npm run start`

# Developing

`npm run watch` is recommended because it will restart the server when the
source code changes. You'll want to copy
[the example file](./env/bot.example.js) to `./env/bot.js` for this command to
work.

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
bot's commands. The ID can be gotten from the API by the organization's
username as `https://api.github.com/users/${organization}`, for instance
`https://api.github.com/users/paritytech` which will respond with:

```json
{
  "login": "paritytech",
  "id": 14176906,
}
```

**At least one organization ID has to be provided for the bot to work.**

`NODE_ENV`

It's recommended to set `NODE_ENV` to `production` so that [Probot logs are
output with structure](https://probot.github.io/docs/logging/#log-formats)
which is handing for querying in your logging aggregator.

## Github Settings

### Repository permissions 

- Metadata: Read-only
- Issues: Read & write
- Pull Requests: Read & write

### Organization permissions

- Members: Read-only

### Event subscriptions

- Issue comment
