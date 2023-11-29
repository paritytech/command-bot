import { Task } from "src/task";
import { PipelineScripts } from "src/types";

export function createCiConfig(
  headSha: string,
  task: Task,
  pipelineScripts: PipelineScripts,
  jobTaskInfoMessage: string,
): object {
  const artifactsFolderPath = ".git/.artifacts";
  return {
    workflow: { rules: [{ if: `$CI_PIPELINE_SOURCE == "api"` }, { if: `$CI_PIPELINE_SOURCE == "web"` }] },
    command: {
      timeout: "24 hours",
      ...task.gitlab.job, // timeout could be overridden from the command configs
      script: [
        ...`
        echo "This job is related to task ${task.id}. ${jobTaskInfoMessage}."

        # The scripts repository might be left over from a previous run in the
        # same Gitlab shell executor
        rm -rf "$PIPELINE_SCRIPTS_DIR"

        if [ "\${PIPELINE_SCRIPTS_REPOSITORY:-}" ]; then
          if [ "\${PIPELINE_SCRIPTS_REF:-}" ]; then
            git clone --progress --verbose --depth 1 --branch "$PIPELINE_SCRIPTS_REF" "$PIPELINE_SCRIPTS_REPOSITORY" "$PIPELINE_SCRIPTS_DIR"
          else
            git clone --progress --verbose --depth 1 "$PIPELINE_SCRIPTS_REPOSITORY" "$PIPELINE_SCRIPTS_DIR"
          fi
        fi
        export ARTIFACTS_DIR="$PWD/${artifactsFolderPath}"
        # The artifacts directory might be left over from a previous run in
        # the same Gitlab shell executor
        rm -rf "$ARTIFACTS_DIR"
        mkdir -p "$ARTIFACTS_DIR"
        `.split("\n"),
        task.command,
      ],
      artifacts: {
        name: "${CI_JOB_NAME}_${CI_COMMIT_REF_NAME}",
        expire_in: "7 days",
        when: "always",
        paths: [artifactsFolderPath],
      },
      variables: {
        // overrideable variables
        PIPELINE_SCRIPTS_REF: pipelineScripts?.ref,
        ...task.gitlab.job.variables,
        // non-overrideable variables
        GH_OWNER: task.gitRef.upstream.owner,
        GH_OWNER_REPO: task.gitRef.upstream.repo,
        ...(task.gitRef.upstream.branch ? { GH_OWNER_BRANCH: task.gitRef.upstream.branch } : {}),
        GH_CONTRIBUTOR: task.gitRef.contributor.owner,
        GH_CONTRIBUTOR_REPO: task.gitRef.contributor.repo,
        GH_CONTRIBUTOR_BRANCH: task.gitRef.contributor.branch,
        GH_HEAD_SHA: headSha,
        COMMIT_MESSAGE: task.command,
        PIPELINE_SCRIPTS_REPOSITORY: pipelineScripts?.repository,
        PIPELINE_SCRIPTS_DIR: ".git/.scripts",
      },
    },
  };
}
