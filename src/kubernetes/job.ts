import { BatchV1Api, CoreV1Api, KubeConfig, V1Container, V1Job, V1ObjectMeta } from "@kubernetes/client-node";

import { getNextTaskId } from "src/task";

export async function createJob(opts: {
  image: string;
  repo: string;
  revision: string;
  variables: { [key: string]: unknown };
  scriptPath: string;
  callback: () => void;
}): Promise<V1Job | Error> {
  const { image, repo, revision, scriptPath, variables, callback } = opts;
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

  // Setting environment variables
  container.env = Object.keys(variables).map((key) => {
    return { name: key, value: variables[key] as string };
  });

  const repoDirName = repo.split("/").pop()?.split(".git")[0] || "repository"; // extracts repo name

  container.command = [
    "/bin/sh",
    "-c",
    `
    cat << 'EOF' > /tmp/script.sh
        
    echo "This job is related to task ${jobId}."
    # clone the contributors repository
    git clone --progress --verbose --depth 1 --branch "${revision}" "${repo}" "${repoDirName}"
    
    cd "$repoDirName"

    if [ "\${PIPELINE_SCRIPTS_REPOSITORY:-}" ]; then
      if [ "\${PIPELINE_SCRIPTS_REF:-}" ]; then
        git clone --progress --verbose --depth 1 --branch "$PIPELINE_SCRIPTS_REF" "$PIPELINE_SCRIPTS_REPOSITORY" "$PIPELINE_SCRIPTS_DIR"
      else
        git clone --progress --verbose --depth 1 "$PIPELINE_SCRIPTS_REPOSITORY" "$PIPELINE_SCRIPTS_DIR"
      fi
    fi
    echo "Running script ${scriptPath}"
    bash ${scriptPath}
    EOF
    sh /tmp/script.sh
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
