# Removing the Agent Runner

The whole subsystem can be deleted in under two minutes. It was built to be
removable: all new code lives in two directories, and it touches **six** existing
files, each inside `AGENT_RUNNER_START` / `AGENT_RUNNER_END` markers.

> The original design allowed four touch points. Two more were added
> deliberately, both pure UI entry points: without them the entire subsystem was
> reachable only by typing a URL, which is unusable in a demo. They are listed as
> 3.5 and 3.6 below and remove exactly like the others.

## The 10-second version

If you only want it **off**, delete nothing:

```
AGENT_RUNNER_ENABLED=false
```

That is the default. `register()` returns before requiring anything, so no routes
mount, no worker starts, no cron schedules, no Redis connections open, no Docker
socket is touched, and `dockerode` / `bullmq` / `node-cron` never enter the module
cache. Pinned by `tests/agent-runner/disabled.test.js`.

---

## Full removal

### 1. Delete these directories

```bash
rm -rf server/src/agent-runner/
rm -rf server/tests/agent-runner/
rm -rf client/src/features/agent-runner/
rm -rf artifacts/                     # run output, if any exists
```

### 2. Delete these standalone files

```bash
rm -f scripts/seed-demo.js scripts/demo.sh scripts/budget-report.js
rm -f e2e/tests/agent-runner-verify.spec.js e2e/tests/editor-run-verify.spec.js
rm -f .env.agent-runner.example
rm -f SECURITY.md REMOVAL.md AGENT_RUNNER.md PLAN.md VERIFICATION.md
rm -rf verification/                  # screenshots from live verification
rmdir scripts 2>/dev/null || true     # only if you have nothing else there
```

### 3. Revert the four touch points

Each is one marked block. Delete the marker lines and everything between them.

---

#### 3.1 — `server/src/app.js`

Remove:

```js
// AGENT_RUNNER_START
require("./agent-runner").register(app);
// AGENT_RUNNER_END
```

Located after `app.use("/api/review", reviewRoutes);`. One line of code.

---

#### 3.2 — `client/src/App.jsx`

Two blocks. Remove the import:

```jsx
// AGENT_RUNNER_START
import agentRunnerRoutes from "./features/agent-runner/routes.jsx";
// AGENT_RUNNER_END
```

and the route expression inside `<Routes>`:

```jsx
{/* AGENT_RUNNER_START */}
{agentRunnerRoutes(PrivateRoute)}
{/* AGENT_RUNNER_END */}
```

> Two lines rather than one because ESM has no inline `require`, and the routes
> must be a direct child of `<Routes>`.

---

#### 3.5 — `client/src/pages/Editor.jsx`

Three blocks. Remove the import:

```jsx
// AGENT_RUNNER_START
import RunCodePanel from "../features/agent-runner/components/RunCodePanel.jsx";
import VerifyFixPanel from "../features/agent-runner/components/VerifyFixPanel.jsx";
// AGENT_RUNNER_END
```

the two tab entries:

```jsx
              // AGENT_RUNNER_START
              { key: "run", label: "Run" },
              { key: "verify", label: "Verify" },
              // AGENT_RUNNER_END
```

and the two panel renders:

```jsx
            {/* AGENT_RUNNER_START */}
            {activePanel === "run" && <RunCodePanel code={currentContent} language={language} />}
            {activePanel === "verify" && (
              <VerifyFixPanel code={currentContent} language={language} />
            )}
            {/* AGENT_RUNNER_END */}
```

> Removing these leaves Chat / AI Review / Versions exactly as they were. The
> AI reviewer is untouched by this subsystem in every respect.

---

#### 3.6 — `client/src/pages/Dashboard.jsx`

One block in the header:

```jsx
        {/* AGENT_RUNNER_START */}
        <button type="button" onClick={() => navigate("/runs")} className="...">
          Agent Runs →
        </button>
        {/* AGENT_RUNNER_END */}
```

---

#### 3.3 — `docker-compose.yml`

Two blocks on the `server` service. Under `environment:`:

```yaml
      # AGENT_RUNNER_START
      - AGENT_RUNNER_ARTIFACTS_PATH=/app/artifacts
      - AGENT_RUNNER_ARTIFACTS_HOST_PATH=${PWD}/artifacts
      # AGENT_RUNNER_END
```

and under `volumes:`:

```yaml
      # AGENT_RUNNER_START
      - /var/run/docker.sock:/var/run/docker.sock
      - ./artifacts:/app/artifacts
      # AGENT_RUNNER_END
```

> Removing the socket mount is worthwhile on its own — see SECURITY.md §3.
> These blocks are additions **inside** the existing `environment:` and
> `volumes:` keys; do not delete the keys themselves.

---

#### 3.4 — `server/package.json`

Remove three dependencies:

```json
"bullmq": "^5.81.3",
"dockerode": "^4.0.12",
"node-cron": "^3.0.3",
```

Then `cd server && npm install` to prune `package-lock.json`.

> `package.json` carries no marker comments: JSON has no comment syntax, and a
> `//`-keyed entry inside `dependencies` would be read by npm as a package name.
> These three lines are the entire change — **no existing dependency version was
> bumped by this work.**
>
> One caveat: the Phase 1 commit also carries a pre-existing uncommitted change
> in your working tree, `chromadb 1.7.3 → ^1.9.2`. That was not made by this
> work and should **not** be reverted as part of removing the subsystem.

---

### 4. Environment variables

Every `AGENT_RUNNER_*` variable plus `DEMO_CACHE` can be deleted from `.env`.
Nothing else reads them — the subsystem deliberately kept its own config rather
than extending `server/src/config/index.js`, so that file needs no edit.

### 5. Optional cleanup

```bash
docker rmi agent-sandbox:node20
docker ps -aq --filter label=codesync.agentrun | xargs -r docker rm -f
redis-cli -n 3 FLUSHDB          # the runner's dedicated Redis DB
```

Mongo collections `agentruns` and `agenttasks` can be dropped. No existing
collection was modified.

---

## Verifying the removal

```bash
cd server && npm test          # should pass exactly as before
cd client && npx vite build    # should build clean
git grep -n "AGENT_RUNNER"     # should return nothing
git grep -n "agent-runner"     # should return nothing
git grep -n "RunCodePanel\|VerifyFixPanel"   # should return nothing
```

## Why it comes out this cleanly

- **No existing file was modified beyond the four touch points.** Enforced by a
  test (`isolation.test.js`), which asserts the `app.js` block is exactly one
  line and that no file outside `src/agent-runner/` ever requires into it.
- **No shared module was refactored.** The subsystem reuses `AppError`,
  `asyncHandler`, `logger`, `authenticate` and `createRateLimiter` by importing
  them, and changed none of them.
- **No shared state was repurposed.** BullMQ runs on its own Redis logical DB
  (default 3) with its own prefix and its own ioredis clients; the app's keys all
  live on DB 0 under `collab:`. The only DB-0 keys the runner creates are two
  rate-limit namespaces, `collab:agentrunner:webhook:*` and
  `collab:agentrunner:manual:*`, which expire on their own within 60 seconds.
- **The editor, Yjs sync and the RAG reviewer were never touched.** The reviewer
  keeps its own Gemini client and its own model-fallback chain; the runner
  deliberately built a separate one rather than sharing.
