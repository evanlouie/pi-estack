import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

const CLOJURE_FILE_RE = /\.(clj|cljs|cljc|cljd|edn|bb)$/i;
const MUTATING_TOOLS = new Set(["edit", "write"]);
const REPAIR_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT = 2_000;
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

function targetPath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const { path, file_path } = input as { path?: unknown; file_path?: unknown };
  const candidate = typeof path === "string" ? path : file_path;
  return typeof candidate === "string" ? candidate : undefined;
}

function expandPath(path: string): string {
  const normalized = path.replace(/^@/, "").replace(UNICODE_SPACES, " ");
  if (normalized === "~") {
    return homedir();
  }
  if (normalized.startsWith("~/")) {
    return homedir() + normalized.slice(1);
  }
  return normalized;
}

function resolveToCwd(path: string, cwd: string): string {
  const expanded = expandPath(path);
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

function summarizeOutput(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    return "no output; is clj-paren-repair on PATH?";
  }
  return trimmed.length > OUTPUT_LIMIT
    ? `${trimmed.slice(0, OUTPUT_LIMIT)}… [truncated]`
    : trimmed;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_result", async (event, ctx) => {
    if (!MUTATING_TOOLS.has(event.toolName) || event.isError) {
      return undefined;
    }

    const path = targetPath(event.input);
    if (!path || !CLOJURE_FILE_RE.test(path)) {
      return undefined;
    }

    const absolutePath = resolveToCwd(path, ctx.cwd);

    try {
      const result = await withFileMutationQueue(absolutePath, () =>
        pi.exec("clj-paren-repair", [absolutePath], {
          cwd: ctx.cwd,
          timeout: REPAIR_TIMEOUT_MS,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        }),
      );

      if (result.code === 0 && !result.killed) {
        const message = `Ran clj-paren-repair on ${path}`;
        if (ctx.hasUI) {
          ctx.ui.notify(message, "info");
        }
        return {
          content: [
            ...event.content,
            { type: "text" as const, text: `\n\n${message}` },
          ],
        };
      }

      const reason = result.killed
        ? "process was killed or timed out"
        : summarizeOutput(
            result.stderr || result.stdout || `exit code ${result.code}`,
          );
      const message = `clj-paren-repair failed for ${path}: ${reason}`;
      if (ctx.hasUI) {
        ctx.ui.notify(message, "warning");
      }
      return {
        content: [
          ...event.content,
          { type: "text" as const, text: `\n\n${message}` },
        ],
      };
    } catch (error) {
      const message = `clj-paren-repair failed for ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      if (ctx.hasUI) {
        ctx.ui.notify(message, "warning");
      }
      return {
        content: [
          ...event.content,
          { type: "text" as const, text: `\n\n${message}` },
        ],
      };
    }
  });
}
