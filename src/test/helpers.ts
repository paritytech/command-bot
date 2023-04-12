import { ensureDefined } from "@eng-automation/js";
import { createHmac } from "crypto";
import fetch from "node-fetch";

import { webhookFixtures } from "./fixtures";
import { CommentWebhookParams } from "./fixtures/github/commentWebhook";
import { getWebhookPort } from "./setup/bot";

export async function triggerWebhook(
  fixture: keyof typeof webhookFixtures,
  params?: Partial<CommentWebhookParams>,
  eventId?: string,
): Promise<void> {
  const body = webhookFixtures[fixture]({ ...params } as CommentWebhookParams);
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  const normalisedBody = toNormalizedJsonString(JSON.parse(body) as object);
  const signature1 = createHmac("sha1", "webhook_secret_value").update(normalisedBody).digest("hex");
  const signature256 = createHmac("sha256", "webhook_secret_value").update(normalisedBody).digest("hex");

  const webhookPort = ensureDefined<number>(getWebhookPort());
  await fetch(`http://localhost:${webhookPort}`, {
    method: "POST",
    body: normalisedBody,
    headers: {
      "X-Hub-Signature": `sha1=${signature1}`,
      "X-Hub-Signature-256": `sha256=${signature256}`,
      "X-GitHub-Event": "issue_comment.created",
      "X-GitHub-Delivery": eventId || "72d3162e-cc78-11e3-81ab-4c9367dc0958",
    },
  });
}

// @see https://github.com/octokit/webhooks.js/blob/37fac3996a8aca3769ce8f435fd05074d06c6536/src/to-normalized-json-string.ts
export function toNormalizedJsonString(payload: object): string {
  const payloadString = JSON.stringify(payload);
  return payloadString.replace(/[^\\]\\u[\da-f]{4}/g, (s) => s.substring(0, 3) + s.substring(3).toUpperCase());
}

/**
 * This is basically a Promise that can be resolved externally
 *
 * @example
 * ```ts
 * const de = new DetachedExpectation()
 *
 * // Somewhere in another callback
 * de.expect(() => {
 *   expect(something).toEqual()
 * })
 *
 * // Then in another place we can wait for it
 *
 * await de.promise
 * ```
 */
export class DetachedExpectation {
  public promise: Promise<void>;
  private resolve?: () => void;
  private reject?: (e: unknown) => void;

  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  public expect(expectation: () => unknown): void {
    try {
      expectation();
    } catch (e) {
      this.reject?.(e);
      return;
    }
    this.resolve?.();
  }

  // if you just need to resolve it without any other parameters
  public satisfy(): void {
    this.resolve?.();
  }
}
