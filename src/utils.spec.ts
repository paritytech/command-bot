import { retriable } from "src/utils";

describe("retriable", () => {
  const wrapRetriable = async (fakeRetryCount: number) =>
    await retriable(
      async () =>
        await new Promise((resolve, reject) => {
          if (fakeRetryCount > 0) {
            fakeRetryCount--;
            reject(0);
          } else {
            resolve(1);
          }
        }),
      { timeoutMs: 100, attempts: 3 },
    );

  test("resolve after 1/3 times", async () => {
    const res = await wrapRetriable(1);
    expect(res).toBe(1);
  });

  test("resolve after 2/3 times", async () => {
    const res = await wrapRetriable(2);

    expect(res).toBe(1);
  });

  test("reject after 3/3 times", async () => {
    try {
      await wrapRetriable(3);
    } catch (e) {
      expect(e).toEqual(0);
    }
  });
});
