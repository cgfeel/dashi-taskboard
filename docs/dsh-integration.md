# DeepSeek Harness integration

This document is the runbook for running Codex Taskboard inside DeepSeek Harness (DSH)
Web. It covers the two moving parts, how to start them, where the data lives, and the
branch this integration is developed on.

- **Taskboard service**: the local HTTP server that serves the built UI and the JSON API
  (`http://127.0.0.1:47823` by default).
- **DSH Web plugin** (`integrations/deepseek-harness`): the sidebar entry that embeds the
  Taskboard URL in an iframe. It does **not** start the service.

DSH does not start Taskboard for you, and Taskboard does not start DSH. Start both.

## Development branch

This fork develops the panel integration on **`levi/panel-integration`**
(based on `origin/main` plus the integration commit). Run that branch when using the
embedded panel:

```bash
cd ~/github/dashi-taskboard
git switch levi/panel-integration
npm ci          # only when dependencies changed
npm run build:web
```

`main` mirrors the upstream merge; keep the branch current with:

```bash
git fetch origin
git rebase origin/main
npm run build:web
# then restart the service (see below)
```

The served UI comes from `dist/web`, which is git-ignored: after pulling or switching
branches run `npm run build:web` before restarting the service.

## Install the plugin into the DSH Web profile

The profile lives at `~/.dsh/profiles/web`. It links this repository:

`package.json`:

```json
"dsh-codex-taskboard": "link:/home/levi/github/dashi-taskboard/integrations/deepseek-harness"
```

`node_modules/dsh-codex-taskboard` is a symlink to
`../../../../github/dashi-taskboard/integrations/deepseek-harness`, and the package is
listed in `dsh.profile.bundles`. After changing either file (or moving this repository),
restart `dsh web`; reloading the page is not enough because the host half is loaded at
boot.

## Start the Taskboard service

Foreground (stops with the terminal):

```bash
cd ~/github/dashi-taskboard
npm start
```

Persistent background, detached from the terminal and from DSH:

```bash
(cd ~/github/dashi-taskboard && npm start > /tmp/dashi-taskboard.log 2>&1 &)
```

The subshell exits immediately and `npm start` is reparented to init, so it keeps running
after the terminal closes and after DSH restarts. Verify:

```bash
sleep 1
curl -sI http://127.0.0.1:47823/ | head -1        # HTTP/1.1 200 OK
ps -eo pid,ppid,cmd | grep "server/index.mjs" | grep -v grep   # PPID is 1
tail -f /tmp/dashi-taskboard.log
```

Combined start (what previous sessions used):

```bash
(cd ~/github/dashi-taskboard && npm start > /tmp/dashi-taskboard.log 2>&1 &) && npx @deepseek-ai/dsh web
```

If the port is already serving, start only `npx @deepseek-ai/dsh web`; a second
`npm start` fails with `EADDRINUSE: address already in use 0.0.0.0:47823`. Stop the old
instance with `pkill -f "github/dashi-taskboard/server/index.mjs"` and start again.

The background form does not survive a Windows restart. To auto-start on boot, use a
systemd unit:

```ini
# /etc/systemd/system/codex-taskboard.service
[Unit]
Description=Codex Taskboard (dashi-taskboard)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=levi
Group=levi
WorkingDirectory=/home/levi/github/dashi-taskboard
Environment=NODE_ENV=production
ExecStart=/home/levi/.nvm/versions/node/v22.22.0/bin/node server/index.mjs
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now codex-taskboard
journalctl -u codex-taskboard -f
```

## Stop or restart the service

Foreground (`npm start` in a terminal): press `Ctrl+C`; the server closes gracefully and
releases port 47823.

Background/persistent start (`(cd ~/github/dashi-taskboard && npm start > /tmp/… &)`): the
process tree is `npm start` → `sh -c node server/index.mjs` → `node server/index.mjs`, and the
whole subtree is reparented to init. Stop the **node** process, not the `sh` wrapper:

```bash
# 1) find the process holding the port
ss -ltnp | grep 47823            # users:(("node",pid=NNN,fd=24))
# or
pgrep -af "github/dashi-taskboard/server/index.mjs"

# 2) graceful stop (the server handles SIGTERM)
kill <node-pid>
# or in one step
pkill -f "github/dashi-taskboard/server/index.mjs"

# 3) wait until the port is free before starting again
until ! curl -fsS -o /dev/null http://127.0.0.1:47823/; do sleep 0.25; done
ss -ltnp | grep 47823 || echo "port free"
```

Notes:

- Kill the `node` PID, not the `sh -c` wrapper: killing the wrapper first leaves `node`
  holding the port as an orphan and the next start fails with `EADDRINUSE`.
  `kill <node-pid>` makes the wrapper exit on its own.
- `fuser -k 47823/tcp` also works but is less precise; prefer SIGTERM, keep `kill -9` as a
  last resort (SIGTERM closes the SQLite connection cleanly).
- Restarting = stop, then run the background start command again; the log stays at
  `/tmp/dashi-taskboard.log`.
- With the systemd unit, use `sudo systemctl stop codex-taskboard` /
  `sudo systemctl restart codex-taskboard`. Do not `kill` it by hand: `Restart=on-failure`
  starts it again.

## Data directory

The service keeps its SQLite database, cloud companion config and attachments in
`.data/` under the repository root:

```text
.data/taskboard.sqlite
.data/cloud-companion.json
```

When moving to a new checkout, stop the old service first and copy the directory so the
copy includes a consistent WAL state:

```bash
pkill -f "server/index.mjs"
cp -a /old/checkout/.data /new/checkout/.data
```

The first boot on the new checkout migrates the schema automatically. Never run two
servers against the same data directory.

## What the integration adds

The plugin forwards the active DSH session's working directory to the panel and the panel
uses it:

- the taskboard project matching the workspace path is selected automatically, and created
  on demand (`ws-<hash>` project id) when missing;
- an issue that is already bound to a conversation shows **Continue**: the panel reopens
  that DSH session, replays the issue instruction, and closes itself;
- "View conversation" opens the bound session read-only; an unknown session reports an
  error instead of failing silently;
- every delivered issue instruction carries the host rule: when the issue needs user
  confirmation, move it to `blocked` and comment what is being waited on (only delivered
  work goes to `in_review`);
- the issue composer's `@` menu adds two separate context groups — **DSH files & folders**
  and **DSH conversations** — fed by the plugin bridge; selected conversation mentions are
  replayed into the execution prompt as referenced context, while file mentions stay as
  readable paths for the agent.

## Verify the integration

```bash
curl -s http://127.0.0.1:47823/api/meta
# manageTaskboardSkillPath must point at this checkout:
# /home/levi/github/dashi-taskboard/skills/manage-taskboard/SKILL.md

curl -s http://127.0.0.1:47823/api/projects
```

Then refresh DSH, open **任务面板**, and confirm the project matches the current workspace,
the issue shows **Continue** when a conversation is bound, and the panel closes after
navigation.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `EADDRINUSE ... 47823` | Another Taskboard service is running. Stop it with `pkill -f "server/index.mjs"` (or `fuser -k 47823/tcp`) before starting a new one. |
| Panel is blank / `503 Codex Taskboard is not running.` | The service is not reachable. Start `npm start` and confirm `curl -sI http://127.0.0.1:47823/`. The plugin falls back to `http://127.0.0.1:47823` when no launcher runtime file exists. |
| UI returns `NOT_FOUND` / `Resource not found` | `dist/web` is missing or stale. Run `npm run build:web` and restart the service. |
| No "任务面板" entry in the DSH sidebar | The plugin is not in the profile bundles. Check `~/.dsh/profiles/web/package.json` and the `node_modules` link, then restart `dsh web`. |
| Plugin changes do not appear | Host-half changes need a `dsh web` restart; client bundles are rebuilt by the DSH watcher. |
| `node: SQLite is an experimental feature` | Node warning only, not an error. The repo declares `engines: ^22.22.3 || >=24.8.0`; older Node may warn on install. |
