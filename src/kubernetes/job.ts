import { BatchV1Api, CoreV1Api, KubeConfig, V1Container, V1EnvVar, V1Job, V1ObjectMeta } from "@kubernetes/client-node";

import { config } from "src/config";
import { getNextTaskId } from "src/task";
import { GitRef } from "src/types";

export type JobGitRef = GitRef & {
  contributor: {
    repoUrl: string;
    headSha: string;
  };
};

export async function createJob(opts: {
  container: {
    image: string;
    variables: { [key: string]: unknown };
    command: string;
  };
  gitRef: JobGitRef;
  callback: () => void;
}): Promise<V1Job | Error> {
  const { image, variables, command } = opts.container;
  const { gitRef, callback } = opts;
  const namespace = "default";
  const kc = new KubeConfig();
  kc.loadFromDefault();

  const batchV1Api = kc.makeApiClient(BatchV1Api);
  const coreV1Api = kc.makeApiClient(CoreV1Api);

  const jobId = getNextTaskId();
  const jobName = "cmd-bot-job-" + jobId;

  const job = new V1Job();
  job.apiVersion = "batch/v1";
  job.kind = "Job";

  const metadata = new V1ObjectMeta();
  metadata.name = jobName;
  metadata.annotations = { "cronjob.kubernetes.io/instantiate": "manual" };
  job.metadata = metadata;

  const container = new V1Container();
  container.name = "job-container";
  container.image = image;

  const env: { [key: string]: string } = {
    // overrideable variables
    PIPELINE_SCRIPTS_REF: config.pipelineScripts?.ref,
    ...variables,
    // non-overrideable variables
    GH_OWNER: gitRef.upstream.owner,
    GH_OWNER_REPO: gitRef.upstream.repo,
    ...(gitRef.upstream.branch ? { GH_OWNER_BRANCH: gitRef.upstream.branch } : {}),
    GH_CONTRIBUTOR: gitRef.contributor.owner,
    GH_CONTRIBUTOR_REPO: gitRef.contributor.repo,
    GH_CONTRIBUTOR_BRANCH: gitRef.contributor.branch,
    GH_HEAD_SHA: gitRef.contributor.headSha,
    COMMIT_MESSAGE: command,
    PIPELINE_SCRIPTS_REPOSITORY: config.pipelineScripts?.repository,
    PIPELINE_SCRIPTS_DIR: ".git/.scripts",
  };

  // Setting environment variables
  container.env = Object.keys(env)
    .map((key) => {
      const v = new V1EnvVar();
      v.name = key;
      v.value = env[key];
      return v;
    })
    .filter((v) => typeof v !== "undefined");

  // get GH token for Job to push to contribotors repo

  const repoDirName = gitRef.contributor.repo;

  container.command = ["/bin/sh"];
  container.args = [
    "-c",
    `
      echo "This job is related to task 1-520f3644-d949-4cc0-a07d-e2a0298c6f54" &&
      echo "Clone repository ${gitRef.contributor.repoUrl} at revision ${gitRef.contributor.branch}" &&
      git clone --progress --verbose --depth 1 --branch "${gitRef.contributor.branch}" "${gitRef.contributor.repoUrl}" &&
      cd "${repoDirName}" &&
      if [ "\${PIPELINE_SCRIPTS_REPOSITORY:-}" ]; then
        if [ "\${PIPELINE_SCRIPTS_REF:-}" ]; then
          echo "Clone pipeline scripts repository \${PIPELINE_SCRIPTS_REPOSITORY} at revision \${PIPELINE_SCRIPTS_REF} into $PIPELINE_SCRIPTS_DIR" &&
          git clone --progress --verbose --depth 1 --branch "$PIPELINE_SCRIPTS_REF" "$PIPELINE_SCRIPTS_REPOSITORY" "$PIPELINE_SCRIPTS_DIR"
        else
          echo "Clone pipeline scripts repository \${PIPELINE_SCRIPTS_REPOSITORY} at HEAD into $PIPELINE_SCRIPTS_DIR" &&
          git clone --progress --verbose --depth 1 "$PIPELINE_SCRIPTS_REPOSITORY" "$PIPELINE_SCRIPTS_DIR"
        fi
      fi && 
      echo "PIPELINE_SCRIPTS_REPOSITORY:::: \${PIPELINE_SCRIPTS_REPOSITORY}" &&
      echo "Running script ${command}" &&
      bash "${command}"
    `,
  ];

  job.spec = { template: { spec: { containers: [container], restartPolicy: "Never" } } };

  try {
    // Create the Job
    const createJobRes = await batchV1Api.createNamespacedJob(namespace, job);

    // Poll the Job status
    let jobCompleted = false;
    while (!jobCompleted) {
      const jobStatus = await batchV1Api.readNamespacedJobStatus(jobName, namespace);
      jobCompleted = jobStatus.body.status?.succeeded === 1 || jobStatus.body.status?.failed === 1;

      console.log("Job status: ", jobStatus.body.status);

      if (!jobCompleted) await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    // Fetch logs
    const selector = `job-name=${jobName}`;
    const podsList = await coreV1Api.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, selector);

    if (podsList.body?.items?.length > 0) {
      const podName = podsList.body.items[0].metadata?.name;
      if (podName) {
        const podLogs = await coreV1Api.readNamespacedPodLog(podName, namespace);
        console.log(podLogs.body);

        // TODO: parse logs and save to file (to show statically)

        callback();
      } else {
        console.log("Pod name not found");
      }
    } else {
      console.log("Pods list is empty!");
    }

    console.log(createJobRes.body);
    return createJobRes.body;
  } catch (err) {
    console.error(err);
    return err as Error;
  }
}
