import { EventHandler, EventHandlerError } from "src/bot/events/handlers/EventHandler";
import { GenericCommand } from "src/bot/parse/ParsedCommand";
import { PullRequestError } from "src/bot/types";
import { createComment } from "src/github";
import { createJob } from "src/kubernetes/job";
import { CMD_IMAGE } from "src/setup";

export async function genericHandler(this: EventHandler): Promise<PullRequestError | undefined> {
  // eslint-disable-next-line no-invalid-this
  const { ctx, octokit, commentParams, parsedCommand, payload, pr, requester, getError } = this;
  const { repositoryCloneDirectory, gitlab } = ctx;
  if (!(parsedCommand instanceof GenericCommand)) {
    throw new EventHandlerError();
  }

  const { installation } = payload;

  const installationId = installation?.id;
  if (!installationId) {
    return getError("Github Installation ID was not found in webhook payload");
  }

  const { data: fetchedPr } = await octokit.pulls.get({ owner: pr.owner, repo: pr.repo, pull_number: pr.number });

  const contributorUsername = fetchedPr.head?.user?.login;
  if (!contributorUsername) {
    return getError("Failed to read repository owner username for contributor in pull request response");
  }

  const contributorRepository = fetchedPr.head?.repo?.name;
  if (!contributorRepository) {
    return getError("Failed to read repository name for contributor in pull request response");
  }

  const contributorBranch = fetchedPr.head?.ref;
  if (!contributorBranch) {
    return getError("Failed to read branch name for contributor in pull request response");
  }

  const contributorRepoUrl = fetchedPr.head?.repo?.clone_url;
  if (!contributorRepoUrl) {
    return getError("Failed to read repository clone URL for contributor in pull request response");
  }

  const headSha = fetchedPr.head?.sha;

  // Update pr in case the upstream repository has been renamed
  pr.owner = contributorUsername;
  pr.repo = contributorRepository;

  const commentBody = `Preparing command "${parsedCommand.command}". This comment will be updated later.`.trim();

  const createdComment = await createComment(ctx, octokit, { ...commentParams, body: commentBody });

  // const queuedDate = new Date();

  const defaultVariables = parsedCommand.configuration.gitlab?.job.variables;
  const overriddenVariables = parsedCommand.variables;
  let image: string = gitlab.defaultJobImage;

  if (typeof overriddenVariables?.[CMD_IMAGE] === "string") {
    image = overriddenVariables[CMD_IMAGE] as string;
  }

  console.log(
    `Creating job with image ${image} and variables`,
    await createJob({
      container: {
        image,
        variables: Object.assign(defaultVariables, overriddenVariables),
        command: parsedCommand.command,
      },
      gitRef: {
        upstream: {
          owner: fetchedPr.base.repo.owner.login,
          repo: fetchedPr.base.repo.name,
          branch: fetchedPr.base.ref,
        },
        contributor: {
          owner: contributorUsername,
          repo: contributorRepository,
          branch: contributorBranch,
          repoUrl: contributorRepoUrl,
          headSha,
        },
      },
      callback: () => {},
    }),
  );

  // const task: PullRequestTask = {
  //   ...pr,
  //   id: getNextTaskId(),
  //   tag: "PullRequestTask",
  //   requester,
  //   command: parsedCommand.command,
  //   comment: { id: createdComment.id, htmlUrl: createdComment.htmlUrl },
  //   installationId,
  //   gitRef: { upstream, contributor, prNumber: pr.number },
  //   timesRequeued: 0,
  //   timesRequeuedSnapshotBeforeExecution: 0,
  //   timesExecuted: 0,
  //   repoPath: path.join(repositoryCloneDirectory, pr.repo),
  //   queuedDate: serializeTaskQueuedDate(queuedDate),
  //   gitlab: {
  //     job: {
  //       image,
  //       tags: parsedCommand.configuration.gitlab?.job.tags || [],
  //       variables: Object.assign(defaultVariables, overriddenVariables),
  //     },
  //     pipeline: null,
  //   },
  // };

  // const updateProgress = (message: string) =>
  //   updateComment(ctx, octokit, { ...commentParams, comment_id: createdComment.id, body: message });
  // const queueMessage = await queueTask(ctx, task, {
  //   onResult: getPostPullRequestResult(ctx, octokit, task),
  //   updateProgress,
  // });
  // await updateProgress(queueMessage);

  // eslint-disable-next-line no-invalid-this
  this.createdComment = createdComment;
}
