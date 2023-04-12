import { Logger } from "@eng-automation/js";
import { ChildProcess, spawn } from "child_process";
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { mkdir, rm } from "fs/promises";
import path from "path";
import { Readable as ReadableStream } from "stream";

import { LoggerContext } from "src/logger";
import { ToString } from "src/types";
import { redact } from "src/utils";

export const ensureDir = async (dir: string): Promise<void> => {
  // mkdir doesn't throw an error if the directory already exists
  await mkdir(dir, { recursive: true });
};

export const ensureDirSync = (dir: string): void => {
  // mkdir doesn't throw an error if the directory already exists
  mkdirSync(dir, { recursive: true });
};

export const initDatabaseDir = async (dir: string): Promise<void> => {
  await ensureDir(dir);
  await rm(path.join(dir, "LOCK"), {
    // ignore error if the file does not exist
    force: true,
  });
};

export class CommandRunner {
  private logger: Logger;
  private commandOutputBuffer: ["stdout" | "stderr", string][] = [];

  constructor(
    private ctx: LoggerContext,
    private configuration?: {
      itemsToRedact?: string[];
      shouldTrackProgress?: boolean;
      cwd?: string;
      onChild?: (child: ChildProcess) => void;
    },
  ) {
    const { logger } = ctx;
    this.logger = logger.child({ commandId: randomUUID() });
  }

  async run(
    execPath: string,
    args: string[],
    {
      allowedErrorCodes,
      testAllowedErrorMessage,
      shouldCaptureAllStreams,
      stdinInput,
    }: {
      allowedErrorCodes?: number[];
      testAllowedErrorMessage?: (stderr: string) => boolean;
      shouldCaptureAllStreams?: boolean;
      stdinInput?: string;
    } = {},
  ): Promise<string | Error> {
    const { logger: log, commandOutputBuffer } = this;
    return await new Promise<string | Error>((resolve, reject) => {
      const { cwd, itemsToRedact, onChild } = this.configuration || {};

      const rawCommand = `${execPath} ${args.join(" ")}`;
      const commandDisplayed = itemsToRedact?.length ? redact(rawCommand, itemsToRedact) : rawCommand;
      log.info({ execPath, args }, `Executing command ${commandDisplayed}`);

      const child = spawn(execPath, args, { cwd, stdio: "pipe" });

      if (onChild) {
        onChild(child);
      }

      if (stdinInput) {
        const stdinStream = new ReadableStream();
        stdinStream.push(stdinInput);
        stdinStream.push(null);
        stdinStream.pipe(child.stdin);
      }

      // clear
      commandOutputBuffer.splice(0, commandOutputBuffer.length);

      child.stdout.on("data", this.getStreamHandler("stdout"));
      child.stderr.on("data", this.getStreamHandler("stderr"));

      child.on("close", (exitCode, signal) => {
        log.info(
          { exitCode, signal },
          `Command "${commandDisplayed}" finished with exit code ${exitCode ?? "??"}${
            signal ? `and signal ${signal}` : ""
          }`,
        );

        if (signal) {
          return resolve(new Error(`Process got terminated by signal ${signal}`));
        }

        if (exitCode) {
          const rawStderr = commandOutputBuffer
            .reduce((acc, [stream, value]) => (stream === "stderr" ? `${acc}${value}` : acc), "")
            .trim();
          const stderr = itemsToRedact?.length ? redact(rawStderr, itemsToRedact) : rawStderr;
          if (
            !allowedErrorCodes?.includes(exitCode) &&
            (testAllowedErrorMessage === undefined || !testAllowedErrorMessage(stderr))
          ) {
            return reject(new Error(stderr));
          }
        }

        const outputBuf = shouldCaptureAllStreams
          ? commandOutputBuffer.reduce((acc, [_, value]) => `${acc}${value}`, "")
          : commandOutputBuffer.reduce((acc, [stream, value]) => (stream === "stdout" ? `${acc}${value}` : acc), "");
        const rawOutput = outputBuf.trim();
        const output = itemsToRedact?.length ? redact(rawOutput, itemsToRedact) : rawOutput;

        resolve(output);
      });
    });
  }

  private getStreamHandler(channel: "stdout" | "stderr") {
    const { itemsToRedact, shouldTrackProgress } = this.configuration || {};
    return (data: ToString) => {
      const str = itemsToRedact?.length ? redact(data.toString(), itemsToRedact) : data.toString();
      const strTrim = str.trim();

      if (shouldTrackProgress && strTrim) {
        this.logger.info(strTrim, channel);
      }

      this.commandOutputBuffer.push([channel, str]);
    };
  }
}

export const validateSingleShellCommand = async (ctx: LoggerContext, command: string): Promise<string | Error> => {
  const { logger } = ctx;
  const cmdRunner = new CommandRunner(ctx);
  const commandAstText = await cmdRunner.run("shfmt", ["--tojson"], { stdinInput: command });
  if (commandAstText instanceof Error) {
    return new Error(`Command AST could not be parsed for "${command}"`);
  }
  const commandAst = JSON.parse(commandAstText) as {
    Stmts: { Cmd: { Type?: string } }[];
  };
  logger.debug(commandAst.Stmts[0].Cmd, `Parsed AST for "${command}"`);
  if (commandAst.Stmts.length !== 1 || commandAst.Stmts[0].Cmd.Type !== "CallExpr") {
    return new Error(`Command "${command}" failed validation: the resulting command line should have a single command`);
  }
  return command.trim();
};
