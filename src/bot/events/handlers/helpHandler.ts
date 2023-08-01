import { EventHandler, EventHandlerError } from "src/bot/events/handlers/EventHandler";
import { HelpCommand } from "src/bot/parse/ParsedCommand";
import { createComment } from "src/github";

export async function helpHandler(this: EventHandler): Promise<void> {
  // eslint-disable-next-line no-invalid-this
  const { ctx, octokit, commentParams, parsedCommand } = this;
  if (!(parsedCommand instanceof HelpCommand)) {
    throw new EventHandlerError();
  }
  await createComment(ctx, octokit, { ...commentParams, body: `Here's a [link to docs](${parsedCommand.docsPath})` });
}
