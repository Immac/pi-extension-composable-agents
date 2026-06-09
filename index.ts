import type { AgentToolUpdateCallback, ExecResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

const CLI_PATH = "composable-agents";
const STATUS_ID = "composable-agents";
const DEFAULT_TIMEOUT_MS = 120_000;
const STREAM_POLL_MS = 125;
const MAX_STREAM_LINES = 80;

interface JsonCommandResult {
  execResult: ExecResult;
  json: unknown;
}

interface StreamedCliResult {
  execResult: ExecResult;
  stdoutLines: string[];
  parsedLines: unknown[];
  stderr: string;
}

export default function composableAgentsExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "run-pipeline",
    label: "Run Pipeline",
    description:
      "Run a composable-agents pipeline.yaml file and stream JSON-line progress from the CLI into the tool output.",
    promptGuidelines: ["Use run-pipeline when the user wants to execute a composable-agents pipeline."],
    parameters: Type.Object({
      path: Type.String({ description: "Path to the pipeline.yaml file to run" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (signal?.aborted) {
        return cancelledResult("Pipeline run cancelled before start.");
      }

      const displayPath = displayPathFromCwd(ctx.cwd, params.path);
      ctx.ui.notify(`Running composable-agents pipeline: ${displayPath}`, "info");
      ctx.ui.setStatus(STATUS_ID, `Running pipeline: ${displayPath}`);
      onUpdate?.({
        content: [{ type: "text" as const, text: `Starting pipeline: ${displayPath}` }],
        details: { stage: "starting", path: resolve(ctx.cwd, params.path) },
      });

      try {
        const streamed = await runCliJsonLines(pi, ["run", params.path], ctx, signal, onUpdate);
        const finalEvent = streamed.parsedLines.at(-1);
        const summaryText = buildPipelineSummary(displayPath, streamed.execResult, finalEvent, streamed.stderr, streamed.stdoutLines.length);

        ctx.ui.notify(`Pipeline finished: ${displayPath}`, streamed.execResult.code === 0 ? "info" : "error");
        ctx.ui.setStatus(STATUS_ID, `Pipeline finished: ${displayPath}`);

        return {
          content: [{ type: "text" as const, text: summaryText }],
          details: {
            path: resolve(ctx.cwd, params.path),
            code: streamed.execResult.code,
            killed: streamed.execResult.killed,
            stderr: streamed.stderr,
            stdoutLines: streamed.stdoutLines,
            events: streamed.parsedLines,
            finalEvent,
          },
        };
      } catch (error) {
        const message = toErrorMessage(error);
        ctx.ui.notify(`Pipeline failed: ${message}`, "error");
        ctx.ui.setStatus(STATUS_ID, `Pipeline failed: ${displayPath}`);
        return {
          content: [{ type: "text" as const, text: `Failed to run pipeline ${displayPath}: ${message}` }],
          details: {
            path: resolve(ctx.cwd, params.path),
            error: message,
          },
        };
      }
    },
  });

  pi.registerTool({
    name: "validate",
    label: "Validate Agent",
    description: "Validate a composable-agents agent.yaml file via the CLI.",
    promptGuidelines: ["Use validate when the user wants to check an agent.yaml for errors."],
    parameters: Type.Object({
      path: Type.String({ description: "Path to the agent.yaml file to validate" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (signal?.aborted) {
        return cancelledResult("Validation cancelled before start.");
      }

      const displayPath = displayPathFromCwd(ctx.cwd, params.path);
      ctx.ui.notify(`Validating agent: ${displayPath}`, "info");
      ctx.ui.setStatus(STATUS_ID, `Validating: ${displayPath}`);
      onUpdate?.({
        content: [{ type: "text" as const, text: `Validating ${displayPath}...` }],
        details: { stage: "running", path: resolve(ctx.cwd, params.path) },
      });

      try {
        const result = await runCliJson(pi, ["validate", params.path], ctx, signal);
        const validation = asRecord(result.json);
        const valid = validation?.valid === true;
        const text = JSON.stringify(
          result.json ?? {
            valid: result.execResult.code === 0,
            stdout: result.execResult.stdout,
            stderr: result.execResult.stderr,
          },
          null,
          2,
        );

        onUpdate?.({
          content: [{ type: "text" as const, text: valid ? `Validation passed for ${displayPath}` : `Validation finished for ${displayPath}` }],
          details: { stage: "complete", valid, code: result.execResult.code },
        });
        ctx.ui.notify(
          valid ? `Validation passed: ${displayPath}` : `Validation reported issues: ${displayPath}`,
          valid ? "info" : "error",
        );
        ctx.ui.setStatus(STATUS_ID, valid ? `Validation passed: ${displayPath}` : `Validation finished: ${displayPath}`);

        return {
          content: [{ type: "text" as const, text }],
          details: {
            path: resolve(ctx.cwd, params.path),
            validation: result.json,
            code: result.execResult.code,
            stdout: result.execResult.stdout,
            stderr: result.execResult.stderr,
          },
        };
      } catch (error) {
        const message = toErrorMessage(error);
        ctx.ui.notify(`Validation failed: ${message}`, "error");
        ctx.ui.setStatus(STATUS_ID, `Validation failed: ${displayPath}`);
        return {
          content: [{ type: "text" as const, text: `Failed to validate ${displayPath}: ${message}` }],
          details: {
            path: resolve(ctx.cwd, params.path),
            error: message,
          },
        };
      }
    },
  });

  pi.registerTool({
    name: "list-agents",
    label: "List Agents",
    description: "Find every agent.yaml under a directory, validate each one, and return the combined results.",
    promptGuidelines: ["Use list-agents when the user wants to find or list composable agents in a directory."],
    parameters: Type.Object({
      directory: Type.String({ description: "Directory to search for agent.yaml files" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (signal?.aborted) {
        return cancelledResult("Listing agents cancelled before start.");
      }

      const absoluteDirectory = resolve(ctx.cwd, params.directory);
      const displayDirectory = displayPathFromCwd(ctx.cwd, params.directory);
      ctx.ui.notify(`Scanning for agents in ${displayDirectory}`, "info");
      ctx.ui.setStatus(STATUS_ID, `Scanning agents: ${displayDirectory}`);
      onUpdate?.({
        content: [{ type: "text" as const, text: `Searching ${displayDirectory} for agent.yaml files...` }],
        details: { stage: "finding", directory: absoluteDirectory },
      });

      try {
        const findResult = await pi.exec("find", [absoluteDirectory, "-type", "f", "-name", "agent.yaml"], {
          cwd: ctx.cwd,
          signal,
          timeout: DEFAULT_TIMEOUT_MS,
        });

        if (findResult.code !== 0) {
          throw new Error(findResult.stderr.trim() || `find exited with code ${findResult.code}`);
        }

        const files = findResult.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .sort();

        if (files.length === 0) {
          onUpdate?.({
            content: [{ type: "text" as const, text: `No agent.yaml files found in ${displayDirectory}` }],
            details: { stage: "complete", count: 0 },
          });
          ctx.ui.notify(`No agent.yaml files found in ${displayDirectory}`, "info");
          ctx.ui.setStatus(STATUS_ID, `No agents found: ${displayDirectory}`);
          return {
            content: [{ type: "text" as const, text: "[]" }],
            details: {
              directory: absoluteDirectory,
              agents: [],
              count: 0,
              stdout: findResult.stdout,
              stderr: findResult.stderr,
              code: findResult.code,
            },
          };
        }

        const agents: Array<Record<string, unknown>> = [];

        for (const [index, file] of files.entries()) {
          if (signal?.aborted) {
            return cancelledResult(`Listing cancelled after ${index} of ${files.length} file(s).`);
          }

          const relativeFile = relative(ctx.cwd, file) || file;
          onUpdate?.({
            content: [{ type: "text" as const, text: `Validating ${index + 1}/${files.length}: ${relativeFile}` }],
            details: {
              stage: "validating",
              current: index + 1,
              total: files.length,
              file,
            },
          });
          ctx.ui.setStatus(STATUS_ID, `Validating ${index + 1}/${files.length}: ${relativeFile}`);

          const validationResult = await runCliJson(pi, ["validate", file], ctx, signal);
          const validationRecord = asRecord(validationResult.json) ?? {};

          agents.push({
            path: file,
            relativePath: relativeFile,
            code: validationResult.execResult.code,
            stdout: validationResult.execResult.stdout,
            stderr: validationResult.execResult.stderr,
            ...validationRecord,
          });
        }

        const validCount = agents.filter((agent) => agent.valid === true).length;
        const summaryText = JSON.stringify(agents, null, 2);

        onUpdate?.({
          content: [{ type: "text" as const, text: `Validated ${files.length} agent file(s); ${validCount} valid.` }],
          details: { stage: "complete", count: files.length, validCount },
        });
        ctx.ui.notify(`Validated ${files.length} agent file(s) in ${displayDirectory}`, "info");
        ctx.ui.setStatus(STATUS_ID, `Validated ${files.length} agent(s)`);

        return {
          content: [{ type: "text" as const, text: summaryText }],
          details: {
            directory: absoluteDirectory,
            count: files.length,
            validCount,
            invalidCount: files.length - validCount,
            agents,
          },
        };
      } catch (error) {
        const message = toErrorMessage(error);
        ctx.ui.notify(`Agent scan failed: ${message}`, "error");
        ctx.ui.setStatus(STATUS_ID, `Agent scan failed: ${displayDirectory}`);
        return {
          content: [{ type: "text" as const, text: `Failed to list agents in ${displayDirectory}: ${message}` }],
          details: {
            directory: absoluteDirectory,
            error: message,
          },
        };
      }
    },
  });

  pi.registerTool({
    name: "inspect-agent",
    label: "Inspect Agent",
    description: "Inspect a composable-agents agent.yaml file and return its manifest JSON.",
    promptGuidelines: ["Use inspect-agent when the user wants to see an agent's configuration or manifest.", "Composable agents examples are at ~/.extension-manager/extensions/composable-agents/examples/ — inspect agent-scaffolder to learn the pattern."],
    parameters: Type.Object({
      path: Type.String({ description: "Path to the agent.yaml file to inspect" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (signal?.aborted) {
        return cancelledResult("Inspection cancelled before start.");
      }

      const displayPath = displayPathFromCwd(ctx.cwd, params.path);
      ctx.ui.notify(`Inspecting agent: ${displayPath}`, "info");
      ctx.ui.setStatus(STATUS_ID, `Inspecting: ${displayPath}`);
      onUpdate?.({
        content: [{ type: "text" as const, text: `Inspecting ${displayPath}...` }],
        details: { stage: "running", path: resolve(ctx.cwd, params.path) },
      });

      try {
        const result = await runCliJson(pi, ["inspect", params.path], ctx, signal);
        const manifestText = JSON.stringify(
          result.json ?? {
            stdout: result.execResult.stdout,
            stderr: result.execResult.stderr,
            code: result.execResult.code,
          },
          null,
          2,
        );
        const manifest = asRecord(result.json);
        const title = typeof manifest?.id === "string" ? manifest.id : basename(displayPath);

        onUpdate?.({
          content: [{ type: "text" as const, text: `Inspection complete for ${title}` }],
          details: { stage: "complete", id: manifest?.id, type: manifest?.type },
        });
        ctx.ui.notify(`Inspection complete: ${title}`, "info");
        ctx.ui.setStatus(STATUS_ID, `Inspection complete: ${title}`);

        return {
          content: [{ type: "text" as const, text: manifestText }],
          details: {
            path: resolve(ctx.cwd, params.path),
            manifest: result.json,
            code: result.execResult.code,
            stdout: result.execResult.stdout,
            stderr: result.execResult.stderr,
          },
        };
      } catch (error) {
        const message = toErrorMessage(error);
        ctx.ui.notify(`Inspection failed: ${message}`, "error");
        ctx.ui.setStatus(STATUS_ID, `Inspection failed: ${displayPath}`);
        return {
          content: [{ type: "text" as const, text: `Failed to inspect ${displayPath}: ${message}` }],
          details: {
            path: resolve(ctx.cwd, params.path),
            error: message,
          },
        };
      }
    },
  });
}

async function runCliJson(
  pi: ExtensionAPI,
  args: string[],
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<JsonCommandResult> {
  const execResult = await pi.exec(CLI_PATH, [...args], {
    cwd: ctx.cwd,
    signal,
    timeout: DEFAULT_TIMEOUT_MS,
  });

  const candidate = execResult.stdout.trim() || execResult.stderr.trim();
  const json = candidate ? parseJson(candidate) : undefined;
  return { execResult, json };
}

async function runCliJsonLines(
  pi: ExtensionAPI,
  args: string[],
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback | undefined,
): Promise<StreamedCliResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-composable-agents-"));
  const stdoutPath = join(tempDir, "stdout.log");
  const stderrPath = join(tempDir, "stderr.log");
  const stdoutLines: string[] = [];
  const parsedLines: unknown[] = [];
  const renderedLines: string[] = [];
  let consumedLength = 0;
  let pending = "";

  try {
    const commandString = buildShellCommand([CLI_PATH, ...args], stdoutPath, stderrPath);
    const execPromise = pi.exec("bash", ["-lc", commandString], {
      cwd: ctx.cwd,
      signal,
      timeout: DEFAULT_TIMEOUT_MS,
    });

    const settledPromise = execPromise.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    const emitUpdate = () => {
      const text = stdoutLines.length > 0 ? stdoutLines.slice(-MAX_STREAM_LINES).join("\n") : "Waiting for pipeline output...";
      onUpdate?.({
        content: [{ type: "text" as const, text }],
        details: {
          stage: "streaming",
          lineCount: stdoutLines.length,
          lines: stdoutLines.slice(),
          renderedLines: renderedLines.slice(),
          events: parsedLines.slice(),
        },
      });
    };

    const consumeStdout = async (flushRemainder = false) => {
      const text = await safeReadFile(stdoutPath);
      if (text.length < consumedLength) {
        consumedLength = 0;
      }
      const chunk = text.slice(consumedLength);
      consumedLength = text.length;
      if (!chunk && !flushRemainder) {
        return;
      }

      pending += chunk;
      const pieces = pending.split(/\r?\n/);
      pending = pieces.pop() ?? "";

      for (const piece of pieces) {
        pushPipelineLine(piece, stdoutLines, parsedLines, renderedLines);
      }

      if (flushRemainder && pending.trim()) {
        pushPipelineLine(pending, stdoutLines, parsedLines, renderedLines);
        pending = "";
      }

      if (chunk || flushRemainder) {
        const lastRendered = renderedLines.at(-1);
        if (lastRendered) {
          ctx.ui.setStatus(STATUS_ID, trimMiddle(lastRendered, 120));
        }
        emitUpdate();
      }
    };

    while (true) {
      const settled = await Promise.race([settledPromise, sleep(STREAM_POLL_MS).then(() => null)]);
      await consumeStdout(Boolean(settled));

      if (!settled) {
        continue;
      }

      const stderr = await safeReadFile(stderrPath);
      if (!settled.ok) {
        throw settled.error;
      }

      return {
        execResult: settled.value,
        stdoutLines,
        parsedLines,
        stderr,
      };
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function pushPipelineLine(
  line: string,
  stdoutLines: string[],
  parsedLines: unknown[],
  renderedLines: string[],
): void {
  if (!line.trim()) {
    return;
  }

  stdoutLines.push(line);
  const parsed = parseJson(line);
  if (parsed !== undefined) {
    parsedLines.push(parsed);
  }
  renderedLines.push(formatPipelineLine(line));
}

function buildShellCommand(command: string[], stdoutPath: string, stderrPath: string): string {
  const commandText = command.map(quoteShell).join(" ");
  return `${commandText} > ${quoteShell(stdoutPath)} 2> ${quoteShell(stderrPath)}`;
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function formatPipelineLine(line: string): string {
  const parsed = parseJson(line);
  const record = asRecord(parsed);
  if (!record || typeof record.type !== "string") {
    return line;
  }

  switch (record.type) {
    case "pipeline_start": {
      const pipeline = typeof record.pipeline === "string" ? record.pipeline : "pipeline";
      const agents = Array.isArray(record.agents) ? record.agents.join(", ") : "";
      return `pipeline_start: ${pipeline}${agents ? ` [${agents}]` : ""}`;
    }
    case "agent_complete": {
      const agent = typeof record.agent === "string" ? record.agent : "unknown-agent";
      const status = typeof record.status === "string" ? record.status : "unknown";
      return `agent_complete: ${agent} (${status})`;
    }
    case "pipeline_complete": {
      const status = typeof record.status === "string" ? record.status : "unknown";
      const duration = typeof record.duration === "number" ? `${record.duration}ms` : "unknown duration";
      const output = typeof record.output === "string" && record.output ? ` output=${trimMiddle(record.output, 80)}` : "";
      const error = typeof record.error === "string" && record.error ? ` error=${trimMiddle(record.error, 80)}` : "";
      return `pipeline_complete: ${status} in ${duration}${output}${error}`;
    }
    case "pipeline_error": {
      const error = typeof record.error === "string" ? record.error : line;
      return `pipeline_error: ${error}`;
    }
    case "error": {
      const message = typeof record.message === "string" ? record.message : line;
      return `error: ${message}`;
    }
    default:
      return line;
  }
}

function buildPipelineSummary(
  displayPath: string,
  execResult: ExecResult,
  finalEvent: unknown,
  stderr: string,
  lineCount: number,
): string {
  const record = asRecord(finalEvent);
  if (record?.type === "pipeline_complete") {
    return JSON.stringify(
      {
        path: displayPath,
        status: record.status,
        duration: record.duration,
        output: record.output,
        error: record.error,
        lines: lineCount,
        code: execResult.code,
        stderr,
      },
      null,
      2,
    );
  }

  if (record?.type === "pipeline_error") {
    return JSON.stringify(
      {
        path: displayPath,
        status: "pipeline_error",
        error: record.error,
        lines: lineCount,
        code: execResult.code,
        stderr,
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      path: displayPath,
      code: execResult.code,
      killed: execResult.killed,
      lines: lineCount,
      stderr,
      finalEvent,
    },
    null,
    2,
  );
}

function cancelledResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    details: { cancelled: true },
  };
}

function displayPathFromCwd(cwd: string, inputPath: string): string {
  const absolute = resolve(cwd, inputPath);
  const relativePath = relative(cwd, absolute);
  return relativePath && !relativePath.startsWith("..") ? relativePath : absolute;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function trimMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const keep = Math.max(8, Math.floor((maxLength - 3) / 2));
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
}

async function safeReadFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const record = asRecord(error);
    if (record?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}
