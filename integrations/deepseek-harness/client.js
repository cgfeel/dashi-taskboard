window.__ModuleLoader__.load({
  id: "dsh-codex-taskboard",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const { useEffect, useState } = React;

    const ROUTE = "/integrations/codex-taskboard";
    const PANEL_ID = "dsh-codex-taskboard-panel";
    const STYLE_ID = "dsh-codex-taskboard-style";
    // Appended to every issue instruction this host delivers, so a mid-turn
    // question is visible on the board as Blocked instead of polluting the
    // review column (In review means "a delivery is waiting for acceptance").
    const HOST_INSTRUCTION_RULE = [
      "Host rule (deepseek-harness taskboard bridge):",
      "When this issue needs the user to confirm something — an answer to a question, an approval, or a plan review —",
      "move the issue to `blocked` with taskctl and post a comment stating exactly what you are waiting for,",
      "then end your turn. Only move it to `in_review` when a full round of work is delivered for acceptance.",
    ].join("\n");

    function withHostInstructionRule(instruction) {
      const text = typeof instruction === "string" ? instruction.trim() : "";
      if (!text) return text;
      return `${text}\n\n${HOST_INSTRUCTION_RULE}`;
    }


    // Canonical DSH session mentions encode the session id as base64url(JSON string);
    // an older build of this bridge wrote the raw id into the URI, which the host
    // rejects when it prepares references. Both directions are handled here.
    function base64UrlEncode(text) {
      const bytes = new TextEncoder().encode(text);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
    }

    function base64UrlDecode(value) {
      const padded = value.replaceAll("-", "+").replaceAll("_", "/")
        .padEnd(Math.ceil(value.length / 4) * 4, "=");
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }

    function sessionReferenceMention(sessionId, label) {
      const uri = `dsh-session:${base64UrlEncode(JSON.stringify(sessionId))}`;
      return `@[${String(label).replace(/[\\\]]/gu, (character) => `\\${character}`)}](${uri})`;
    }

    function normalizeReferenceMention(reference) {
      const match = /^@\[((?:\\.|[^\\\]])*)\]\(dsh-session:([^\s)]*)\)$/u.exec(reference.trim());
      if (!match) return reference;
      const [, , payload] = match;
      try {
        const decoded = JSON.parse(base64UrlDecode(payload));
        if (typeof decoded === "string") return reference;
      } catch {
        // Not canonical: repair the raw session id written by earlier builds.
      }
      return `@[${match[1]}](dsh-session:${base64UrlEncode(JSON.stringify(payload))})`;
    }

    const CSS = `
.dsh-codex-taskboard-trigger{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:calc(100% + 8px);height:34px;margin:4px -4px;padding:6px 2px 6px 10px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;overflow:hidden}
.dsh-codex-taskboard-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-codex-taskboard-trigger.rail{justify-content:center;width:36px;height:36px;margin:8px 0 10px;padding:0;border-radius:50%}
.dsh-codex-taskboard-label{white-space:nowrap;overflow:hidden}
.dsh-codex-taskboard-panel{position:fixed;z-index:900;display:flex;flex-direction:column;box-sizing:border-box;border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-shadow-lv3)}
.dsh-codex-taskboard-header{display:flex;flex:none;align-items:center;justify-content:space-between;height:48px;padding:8px 14px 8px 18px;box-sizing:border-box;color:var(--dsw-alias-label-primary)}
.dsh-codex-taskboard-actions{display:flex;gap:8px}
.dsh-codex-taskboard-action{border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer;padding:5px 9px;font:inherit}
.dsh-codex-taskboard-action:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-codex-taskboard-frame{flex:1;min-height:0;border:0;background:#fff}
`;

    // Panel instances register their close action here so host-initiated
    // navigation (run/continue an issue, open its conversation) can dismiss the
    // overlay and let the DSH main view take over.
    const panelClosers = new Set();
    function closeTaskboardPanels() {
      for (const close of [...panelClosers]) {
        try {
          close();
        } catch (error) {
          console.error("[codex-taskboard] failed to close the panel:", error);
        }
      }
    }

    function centerColumnBox() {
      for (const element of document.querySelectorAll("*")) {
        for (const className of element.classList) {
          if (!className.endsWith("_centerCol")) continue;
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            right: window.innerWidth - rect.right,
            bottom: window.innerHeight - rect.bottom,
          };
        }
      }
      return { left: 0, top: 0, right: 0, bottom: 0 };
    }

    function useCenterColumnBox() {
      const [box, setBox] = useState(centerColumnBox);
      useEffect(() => {
        const measure = () => setBox(centerColumnBox());
        const observer = new ResizeObserver(measure);
        const column = [...document.querySelectorAll("*")].find((element) =>
          [...element.classList].some((className) => className.endsWith("_centerCol")),
        );
        if (column) observer.observe(column);
        window.addEventListener("resize", measure);
        return () => {
          observer.disconnect();
          window.removeEventListener("resize", measure);
        };
      }, []);
      return box;
    }

    function ChecklistIcon() {
      return React.createElement(
        "svg",
        { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none", "aria-hidden": true },
        React.createElement("path", {
          d: "M3.5 4.5h1.2l.8.9 1.7-2M8 4.5h6.5M3.5 9h1.2l.8.9 1.7-2M8 9h6.5M3.5 13.5h1.2l.8.9 1.7-2M8 13.5h6.5",
          stroke: "currentColor",
          strokeWidth: 1.35,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }),
      );
    }

    function readWorkspacePath(ctx) {
      const sessions = ctx?.sessions ?? ctx?.get?.("sessions");
      const snapshot = sessions?.list?.getSnapshot?.();
      if (!snapshot) return "";
      // SessionListState has no `current` field: the main Conversation is the
      // row this client retains under the `mainView` source.
      const summary = Object.values(snapshot.byId ?? {}).find(
        (candidate) => (candidate?.retainedBy?.mainView ?? 0) > 0,
      );
      return typeof summary?.cwd === "string" ? summary.cwd : "";
    }

    function useWorkspacePath(ctx) {
      const [workspacePath, setWorkspacePath] = useState(() => readWorkspacePath(ctx));
      useEffect(() => {
        const list = (ctx?.sessions ?? ctx?.get?.("sessions"))?.list;
        if (!list?.subscribe) return;
        const update = () => setWorkspacePath(readWorkspacePath(ctx));
        update();
        return list.subscribe(update);
      }, [ctx]);
      return workspacePath;
    }

    function TaskboardPanel({ onClose, workspacePath }) {
      const box = useCenterColumnBox();
      const [generation, setGeneration] = useState(0);
      const query = `refresh=${generation}${workspacePath ? `&workspacePath=${encodeURIComponent(workspacePath)}` : ""}`;
      return React.createElement(
        "aside",
        {
          id: PANEL_ID,
          className: "dsh-codex-taskboard-panel",
          style: box,
          "aria-label": "任务面板",
        },
        React.createElement(
          "div",
          { className: "dsh-codex-taskboard-header" },
          React.createElement("strong", null, "任务面板"),
          React.createElement(
            "div",
            { className: "dsh-codex-taskboard-actions" },
            React.createElement(
              "button",
              {
                type: "button",
                className: "dsh-codex-taskboard-action",
                onClick: () => setGeneration((value) => value + 1),
              },
              "刷新",
            ),
            React.createElement(
              "button",
              { type: "button", className: "dsh-codex-taskboard-action", onClick: onClose },
              "关闭",
            ),
          ),
        ),
        React.createElement("iframe", {
          key: `${generation}:${workspacePath}`,
          className: "dsh-codex-taskboard-frame",
          src: `${ROUTE}?${query}`,
          title: "Codex Taskboard",
          allow: "clipboard-write",
        }),
      );
    }

    function TaskboardEntry({ wide, ctx }) {
      const [open, setOpen] = useState(false);
      const workspacePath = useWorkspacePath(ctx);
      useEffect(() => {
        // Host-initiated navigation (run an issue / open its conversation) takes
        // over the main view, so the overlay panel must get out of the way.
        const close = () => setOpen(false);
        panelClosers.add(close);
        return () => panelClosers.delete(close);
      }, []);
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "button",
          {
            type: "button",
            className: `dsh-codex-taskboard-trigger${wide ? "" : " rail"}`,
            title: "任务面板",
            "aria-label": "任务面板",
            "aria-expanded": open,
            "aria-controls": PANEL_ID,
            onClick: () => setOpen((value) => !value),
          },
          React.createElement(ChecklistIcon),
          wide && React.createElement("span", { className: "dsh-codex-taskboard-label" }, "任务面板"),
        ),
        open && React.createElement(TaskboardPanel, { onClose: () => setOpen(false), workspacePath }),
      );
    }

    const inject = ["slots", "sessions", "workspaces", "remote", "remote.fileReferences", "remote.sessionReferenceResolver"];

    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.dataset.plugin = "dsh-codex-taskboard";
        style.textContent = CSS;
        document.head.appendChild(style);
        return () => style.remove();
      }, "codex-taskboard: styles");

      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
        name: "sidebar.footer.action",
        id: "codex-taskboard",
        order: 0,
      }, (props) => React.createElement(TaskboardEntry, { ...props, ctx })));

      const sessions = ctx.get("sessions");
      const workspaces = ctx.get("workspaces");

      const uiWorkspaceOf = () => {
        try {
          return ctx.get?.("uiWorkspace");
        } catch {
          return undefined;
        }
      };

      // Navigation retains the new Session synchronously, but its shared binding
      // can still be settling; wait briefly before seeding the issue prompt.
      const waitForSessionFace = async (sessionId, timeoutMs = 3_000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() <= deadline) {
          const face = sessions?.binding?.(sessionId)?.session;
          if (face) return face;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return undefined;
      };

      const seedIssueInstruction = async (sessionId, instruction) => {
        if (!instruction) return;
        const face = await waitForSessionFace(sessionId);
        if (!face) throw new Error(`DSH session is not ready: ${sessionId}`);
        await face.open();
        const result = await face.prompt([{ type: "text", text: instruction }], "queue");
        if (result && result.ok === false) {
          throw new Error(result.error?.message ?? "DSH rejected the issue instruction.");
        }
      };

      const openTaskboardSession = async (workspacePath, instruction) => {
        let workspaceId = workspaces?.list?.getSnapshot?.()?.items
          ?.find((item) => item.path === workspacePath)?.workspaceId;
        if (!workspaceId && workspaces?.create) {
          try {
            const created = await workspaces.create({ path: workspacePath });
            workspaceId = created?.workspaceId;
          } catch {
            workspaceId = undefined;
          }
        }
        const sessionId = workspaceId
          ? await sessions.create({ workspaceId })
          : await sessions.create({ cwd: workspacePath });
        const uiWorkspace = uiWorkspaceOf();
        if (uiWorkspace?.openSession) uiWorkspace.openSession(sessionId);
        await seedIssueInstruction(sessionId, instruction);
        return sessionId;
      };

      // A bound issue continues in the conversation that owns it: reopen that
      // Session and re-send the issue instruction so the agent re-reads it.
      const resumeTaskboardSession = async (threadId, instruction) => {
        const uiWorkspace = uiWorkspaceOf();
        if (typeof uiWorkspace?.openSession !== "function") {
          throw new Error("DSH conversation navigation is unavailable.");
        }
        const known = sessions?.list?.getSnapshot?.()?.byId?.[threadId];
        if (!known) throw new Error(`DSH session not found: ${threadId}`);
        uiWorkspace.openSession(threadId);
        await seedIssueInstruction(threadId, instruction);
        return threadId;
      };

      const handleTaskboardMessage = async (event) => {
        const message = event.data;
        if (!message || typeof message !== "object") return;
        const reply = (type, payload) => {
          if (event.source && typeof event.source.postMessage === "function") {
            event.source.postMessage({ type, ...(payload ? { payload } : {}) }, "*");
          }
        };

        // Issue composer context menu: DSH files/folders and conversations are
        // returned as two separated candidate groups.
        if (message.type === "taskboard:reference-candidates") {
          const requestId = typeof message.payload?.requestId === "string"
            ? message.payload.requestId
            : "";
          const query = typeof message.payload?.query === "string"
            ? message.payload.query
            : "";
          if (!requestId) return;
          const empty = () => reply("taskboard:reference-candidates-response", {
            requestId,
            files: [],
            sessions: [],
          });
          const snapshot = sessions?.list?.getSnapshot?.();
          const current = Object.values(snapshot?.byId ?? {}).find(
            (candidate) => (candidate?.retainedBy?.mainView ?? 0) > 0,
          );
          if (!current?.id) {
            empty();
            return;
          }
          let remote;
          try {
            remote = ctx.remote ?? ctx.get?.("remote");
          } catch {
            remote = undefined;
          }
          const fileList = remote?.fileReferences?.list;
          const sessionCandidates = remote?.sessionReferenceResolver?.candidates;
          const controller = new AbortController();
          const abortTimer = setTimeout(() => controller.abort(), 3_000);
          let files = [];
          let conversations = [];
          try {
            const [fileResult, sessionResult] = await Promise.all([
              typeof fileList === "function"
                ? fileList.call(remote.fileReferences, current.id, query, controller.signal)
                : Promise.resolve(null),
              typeof sessionCandidates === "function"
                ? sessionCandidates.call(remote.sessionReferenceResolver, current.id, query, controller.signal)
                : Promise.resolve(null),
            ]);
            const fileValue = Array.isArray(fileResult?.ok ? fileResult.value : null)
              ? fileResult.value
              : [];
            const sessionValue = Array.isArray(sessionResult?.ok ? sessionResult.value : null)
              ? sessionResult.value
              : [];
            files = fileValue.flatMap((candidate) => {
              const path = typeof candidate?.path === "string" ? candidate.path : "";
              if (!path) return [];
              const directory = candidate?.kind === "directory";
              const mention = /\s/u.test(path)
                ? (directory ? `@"${path}/` : `@"${path}"`)
                : `@${path}${directory ? "/" : ""}`;
              return [{
                kind: directory ? "directory" : "file",
                label: directory ? `${path}/` : path,
                mention,
              }];
            });
            conversations = sessionValue.flatMap((candidate) => {
              const sessionId = typeof candidate?.sessionId === "string" ? candidate.sessionId : "";
              if (!sessionId || sessionId === current.id) return [];
              const label = String(candidate.displayTitle ?? candidate.label ?? sessionId);
              const mention = typeof candidate.mention === "string" && candidate.mention.startsWith("@[")
                ? candidate.mention
                : sessionReferenceMention(sessionId, label);
              return [{ kind: "session", label, mention }];
            });
          } catch (error) {
            console.warn("[codex-taskboard] reference candidates failed:", error);
          } finally {
            clearTimeout(abortTimer);
          }
          if (files.length === 0 && conversations.length === 0) {
            console.warn("[codex-taskboard] no DSH context candidates", {
              hasRemote: Boolean(remote),
              hasFileList: typeof fileList === "function",
              hasSessionCandidates: typeof sessionCandidates === "function",
            });
          }
          reply("taskboard:reference-candidates-response", {
            requestId,
            files,
            sessions: conversations,
          });
          return;
        }

        // Conversation bubble / comment "View conversation": reopen the bound
        // Session for reading only; the issue prompt is not re-sent.
        if (message.type === "taskboard:open-thread") {
          const threadId = typeof message.payload?.threadId === "string"
            ? message.payload.threadId.trim()
            : "";
          if (!threadId) {
            reply("taskboard:thread-open-error", { error: "The conversation has no DSH session id." });
            return;
          }
          const uiWorkspace = uiWorkspaceOf();
          if (typeof uiWorkspace?.openSession !== "function") {
            reply("taskboard:thread-open-error", { error: "DSH conversation navigation is unavailable." });
            return;
          }
          if (!sessions?.list?.getSnapshot?.()?.byId?.[threadId]) {
            reply("taskboard:thread-open-error", { error: `DSH session not found: ${threadId}` });
            return;
          }
          try {
            uiWorkspace.openSession(threadId);
            closeTaskboardPanels();
          } catch (error) {
            reply("taskboard:thread-open-error", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        }

        if (message.type !== "taskboard:create-thread") return;
        const workspacePath = typeof message.payload?.workspacePath === "string"
          ? message.payload.workspacePath
          : "";
        const instruction = withHostInstructionRule(
          typeof message.payload?.instruction === "string"
            ? message.payload.instruction
            : "",
        );
        const references = Array.isArray(message.payload?.references)
          ? message.payload.references.filter(
              (reference) => typeof reference === "string" && reference.trim() !== "",
            ).map(normalizeReferenceMention)
          : [];
        const issueInstruction = references.length > 0
          ? `${instruction}\n\nReferenced context selected on the issue:\n${references.join("\n")}`
          : instruction;
        const boundThreadId = typeof message.payload?.threadId === "string"
          ? message.payload.threadId.trim()
          : "";
        if (boundThreadId) {
          try {
            await resumeTaskboardSession(boundThreadId, issueInstruction);
            reply("taskboard:thread-prepared", {});
            closeTaskboardPanels();
          } catch (error) {
            console.error("[codex-taskboard] failed to resume the bound session:", error);
            reply("taskboard:thread-create-error", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        }
        if (!workspacePath) {
          reply("taskboard:thread-create-error", { error: "No workspace path" });
          return;
        }
        try {
          await openTaskboardSession(workspacePath, issueInstruction);
          reply("taskboard:thread-prepared", {});
          closeTaskboardPanels();
        } catch (error) {
          console.error("[codex-taskboard] failed to open a new session:", error);
          reply("taskboard:thread-create-error", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };

      ctx.effect(() => {
        window.addEventListener("message", handleTaskboardMessage);
        return () => window.removeEventListener("message", handleTaskboardMessage);
      }, "codex-taskboard: taskboard messages");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
