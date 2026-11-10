import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const name = "codex-taskboard";
export const inject = ["webServer"];

const ROUTE = "/integrations/codex-taskboard";
const RUNTIME_FILE = process.env.CODEX_TASKBOARD_RUNTIME_FILE
  ?? path.join(os.homedir(), "Library/Application Support/Codex Taskboard/launcher-runtime.json");

function taskboardUrl(baseUrl, workspacePath) {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/`);
  url.searchParams.set("host", "deepseek-harness");
  if (workspacePath) url.searchParams.set("workspacePath", workspacePath);
  return url.href;
}

async function activeTaskboardUrl(workspacePath) {
  try {
    const descriptor = JSON.parse(await readFile(RUNTIME_FILE, "utf8"));
    if (descriptor?.version === 1 && typeof descriptor.url === "string") {
      return taskboardUrl(descriptor.url, workspacePath);
    }
  } catch (_) {
    // Fall back to the manually started local service below.
  }

  return taskboardUrl(process.env.CODEX_TASKBOARD_URL ?? "http://127.0.0.1:47823", workspacePath);
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({
      kind: "exact",
      path: ROUTE,
      handler: async (request, response) => {
        try {
          const requested = new URL(request.url, "http://127.0.0.1").searchParams.get("workspacePath");
          const workspacePath = requested?.trim() || undefined;
          response.writeHead(307, {
            location: await activeTaskboardUrl(workspacePath),
            "cache-control": "no-store",
          });
          response.end();
        } catch {
          response.writeHead(503, {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          });
          response.end("Codex Taskboard is not running.");
        }
      },
    }),
    "codex-taskboard: active runtime route",
  );
}
