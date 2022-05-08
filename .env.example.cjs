/* eslint-disable multiline-comment-style */

// Set the appropriate values and copy this file to env.cjs

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
  The GitLab domain (e.g. gitlab.parity.io) where the CI jobs will be executed
  in. Do not include https:// or any other prefix at the start of the value.
*/
process.env.GITLAB_DOMAIN ??= "placeholder"

/*
  The GitLab namespace (i.e. repository path without the repository name) where
  the GitHub repositories are mirrored to in GitLab. e.g. for a project
  github.com/foo which is hosted in gitlab.parity.io/nested/namespace/foo,
  $GITLAB_PUSH_NAMESPACE would be nested/namespace.
*/
process.env.GITLAB_PUSH_NAMESPACE ??= "placeholder"

/*
  The default image to be used on GitLab jobs for bot commands which don't
  specify a custom image
*/
process.env.GITLAB_DEFAULT_JOB_IMAGE ??= "placeholder"

/*
  GITLAB_ACCESS_TOKEN token needs the following scopes:
  - "write_repository"
  - "read_api"

  Instructions for generating this token are available at:
  https://docs.gitlab.com/ee/security/token_overview.html
*/
process.env.GITLAB_ACCESS_TOKEN ??= "placeholder"
process.env.GITLAB_ACCESS_TOKEN_USERNAME ??= "placeholder"

/*
  Define a $PIPELINE_SCRIPTS_REPOSITORY (full URL to a Git repository, e.g.
  "https://github.com/paritytech/pipeline-scripts") to be cloned on GitLab
  pipelines with ref $PIPELINE_SCRIPTS_REF. Leave it unset to disable
  $PIPELINE_SCRIPTS.
*/
// process.env.PIPELINE_SCRIPTS_REPOSITORY ??= "placeholder"
// process.env.PIPELINE_SCRIPTS_REF ??= "placeholder"

/*
  This private key's file can be generated and downloaded from
  https://github.com/settings/apps/[app-name].
  If you need to calculate the Base64 of the value manually, that can be done
  with `base64 -w 0 private-key.pem`.
*/
process.env.PRIVATE_KEY_BASE64 ??= Buffer.from(
  fs.readFileSync(path.join(__dirname, "githubPrivateKey.pem"), "utf-8"),
).toString("base64")

// The 'data' directory in this location is already ignored on version control
process.env.DATA_PATH ??= path.join(__dirname, "data")

/*
  Comma-separated organizations whose members will be able to run the commands.
  At least one organization ID *has to* be provided for the bot to work.

  The ID for each organization can be figured out by making a request to
  https://api.github.com/users/$org.
*/
process.env.ALLOWED_ORGANIZATIONS ??= "123,456"

/*
  $MASTER_TOKEN is the token for *managing* the API. It is able to create other
  API tokens, but cannot be used as a normal token.
*/
process.env.MASTER_TOKEN ??= "placeholder"

/*
  NOT REQUIRED
  The API interactions needs a Matrix-related variables to be configured for
  notifying when a command finishes. Additionally, MASTER_TOKEN is used for
  allowing tokens to the API. If those are missing, then the API will not work.
*/
// process.env.MATRIX_HOMESERVER ??= "https://matrix.parity.io"
// process.env.MATRIX_ACCESS_TOKEN ??= "placeholder"

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
