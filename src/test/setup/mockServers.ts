import { promises as fs } from "fs";
import * as mockttp from "mockttp";
import selfsigned from "selfsigned";

export type MockServers = {
  gitLab: mockttp.Mockttp;
  gitHub: mockttp.Mockttp;
};
let mockServers: MockServers | null = null;
export const getMockServers = (): MockServers | null => mockServers;

export const selfSignedCertPath = "src/test/.test-ca.pem";
export const selfSignedKeyPath = "src/test/.test-ca.key";

export async function startMockServers(): Promise<MockServers> {
  const defaultParams = { https: { keyPath: selfSignedKeyPath, certPath: selfSignedCertPath } };
  const gitLab = mockttp.getLocal(defaultParams);
  await gitLab.start(0);

  const gitHub = mockttp.getLocal(defaultParams);
  await gitHub.start(0);

  mockServers = { gitHub, gitLab };

  const requestHandler = (name: string) => (request: mockttp.Request) => {
    if (request.matchedRuleId === undefined) {
      console.error(`Unmatched request (${name}): ${request.method} ${request.url}`);
      process.exit(1);
    }
    console.log(`Got matching request: (${name}): ${request.method} ${request.url}`);
  };

  await mockServers?.gitLab.on("request", requestHandler("GitLab"));
  await mockServers?.gitHub.on("request", requestHandler("GitHub"));

  return mockServers;
}

export async function stopMockServers(): Promise<void> {
  await mockServers?.gitHub.stop();
  await mockServers?.gitLab.stop();
}

export async function ensureCert(): Promise<void> {
  try {
    await fs.stat(selfSignedCertPath);
  } catch (e) {
    if (e instanceof Error && e.code !== "ENOENT") {
      throw e;
    }

    const pems = selfsigned.generate([], { keySize: 4096 });
    await fs.writeFile(selfSignedKeyPath, pems.private);
    await fs.writeFile(selfSignedCertPath, pems.cert);
  }
}
