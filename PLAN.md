# Agent Runner — Implementation Plan

> Status: **PLAN ONLY — no code written yet.** Phase 0 recon findings + file-by-file plan.
> Read the "Decisions I need from you" section at the bottom before approving.

---

## Phase 0 — Recon findings

### Server entrypoint & route registration

- **Entrypoint:** [server/src/server.js](server/src/server.js) — `startServer()` does `initRedis()` →
  `connectWithRetry()` (Mongo) → `http.createServer(app)` → `initSocketServer` →
  `registerSocketHandlers` → `listen`. Graceful shutdown wired to SIGINT/SIGTERM.
- **Express app:** [server/src/app.js:59-62](server/src/app.js#L59-L62) — routers mount as
  `app.use("/api/<name>", <name>Routes)`. This is the natural mount point.
- **Router pattern:** `express.Router()` → `router.use(authenticate)` for protected routers →
  per-route `createRateLimiter` + `validate(zodSchema)` → controller.
- **Controllers:** wrapped in `asyncHandler`, respond `{ success: true, data: {...} }`, throw
  `new AppError(msg, status, CODE)` which [errorHandler](server/src/middleware/errorHandler.js) formats.
- **Auth:** [server/src/middleware/auth.js](server/src/middleware/auth.js) — `Bearer` header only,
  sets `req.user = { id, ... }`. No cookie fallback on the access token.

### Mongo model conventions

`mongoose.Schema({...}, { timestamps: true })`, refs via `mongoose.Schema.Types.ObjectId`, and an
instance method (`toMeta()` / `toSummary()`) that returns `{ id: this._id.toString(), ... }` for API
responses. Every function carries a JSDoc block. See
[Document.js](server/src/models/Document.js), [ReviewHistory.js](server/src/models/ReviewHistory.js).

### Redis setup — **important constraint**

[server/src/config/redis.js](server/src/config/redis.js) creates three ioredis clients
(`redisClient`, `redisPub`, `redisSub`) plus Redlock, exposed via getters, with
`enableOfflineQueue: false`.

⚠️ **BullMQ cannot reuse these clients.** BullMQ requires `maxRetriesPerRequest: null` and blocking
commands; `enableOfflineQueue: false` breaks it. The agent runner will open its **own** ioredis
connections to the **same Redis server** (`config.redisUrl`), owned and closed inside
`src/agent-runner/`. Same Redis instance, separate clients — no change to the existing file.

### SSE — reusable? **Yes.**

[review.service.js:361-458](server/src/services/review.service.js#L361-L458) is the pattern:

```js
res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
let closed = false; res.on("close", () => { closed = true; });
const writeSse = (event, data) => { if (closed) return;
  if (event) res.write(`event: ${event}\n`); res.write(`data: ${JSON.stringify(data)}\n\n`); };
```

Client side ([useReview.js](client/src/hooks/useReview.js)) uses `fetch` + `body.getReader()` — **not**
`EventSource` — precisely so it can send the `Authorization: Bearer` header. The runs stream will
mirror both halves exactly. I'll extract the writer into `agent-runner/stream/sse.js` (a copy, not an
import, to keep the subsystem self-contained and deletable).

### Gemini client — **there is no shared wrapper**

Two independent REST callers exist:

| Location | What it does |
| --- | --- |
| [review.service.js:118-217](server/src/services/review.service.js#L118-L217) | `POST {v1}/models/{model}:generateContent` and `:streamGenerateContent?alt=sse`. Recursive **model** fallback over `["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"]` on 404/429/5xx. |
| [rag.service.js:56-80](server/src/services/rag.service.js#L56-L80) | Embeddings via `:embedContent`, retry with backoff on 429/5xx, 1.2 s pacing. |

Both use `https://generativelanguage.googleapis.com/v1` + `?key=`. Config is
`config.gemini.model`, default **`gemini-2.0-flash`** — already Flash, not Pro ✅. The agent runner
gets its own client in `agent-runner/agent/gemini.client.js` reusing this proven request/response
shape, plus the quota controls you specified.

### docker-compose

Services: `mongo` (7), `redis` (7-alpine), `chromadb` (0.5.23), `server` (build ./server),
`client` (build ./client). **No custom networks** — default compose bridge. Volumes: `mongo_data`,
`redis_data`, `chroma_data`. Server Dockerfile is `node:20-alpine`, `npm install --legacy-peer-deps`.

### ❓ Does a code-execution path exist today?

**No.** Grepped `src/` for `child_process`, `spawn`, `exec(`, `execSync`, `docker`, `vm2`,
`isolated-vm`, `new Worker` — the only hit is `pipeline.exec()` in the Redis rate limiter. The app is
**editor + CRDT sync + AI review only**. The sandbox executor is entirely greenfield; there is no
existing execution code to conflict with or accidentally weaken.

---

## Architecture

```
 trigger                queue              worker (concurrency 1)
┌──────────────┐      ┌────────┐      ┌──────────────────────────────┐
│ webhook+HMAC │──┐   │        │      │  orchestrator                │
│ POST /runs   │──┼──▶│ BullMQ │─────▶│   ├─ gemini.client (6/min,   │
│ node-cron    │──┘   │ (Redis)│      │   │   6/run, 200/day)        │
└──────────────┘      └────────┘      │   └─ executor (dockerode)    │
                                      └────────┬─────────────────────┘
   SSE  ◀── redis pub/sub ◀── run events ───────┤
 /api/runs/:id/stream                           ▼
                                     ┌─────────────────────────┐
                                     │ agent-sandbox:node20    │
                                     │ net=none, ro-rootfs,    │
                                     │ tmpfs /workspace, 512m, │
                                     │ 0.5cpu, cap-drop ALL,   │
                                     │ uid 1000, 30s wall      │
                                     └─────────────────────────┘
```

---

## File-by-file plan

### New backend — everything under `server/src/agent-runner/`

> The addendum says `src/agent-runner/`; in this repo the server root is `server/`, so that resolves
> to `server/src/agent-runner/`.

| File | Purpose |
| --- | --- |
| `index.js` | **The only thing app.js knows about.** `register(app)` — returns immediately unless `AGENT_RUNNER_ENABLED=true`. Otherwise mounts the router, boots worker + cron + reaper + pub/sub, and registers its own shutdown hooks. |
| `config.js` | All `AGENT_RUNNER_*` env, zod-parsed, own defaults. Does **not** touch `config/index.js`. |
| `models/AgentTask.js` | Task spec: `name`, `slug`, `prompt`, `fixtures[]`, `cronExpression`, `enabled`. Needed by `/trigger/:taskId`, cron, and the seed script. |
| `models/AgentRun.js` | Per your Phase 5 schema + `budget_exceeded` status, `geminiCalls`, `idempotencyKey` (unique sparse index). |
| `routes/runs.routes.js` | `POST /trigger/:taskId` (HMAC, no JWT), `POST /` (JWT), `GET /`, `GET /:id`, `GET /:id/stream`, `GET /:id/artifacts/:name`. |
| `controllers/runs.controller.js` | Thin, `asyncHandler`, `{ success, data }` envelope. |
| `middleware/hmac.js` | Raw-body HMAC-SHA256 verify (timing-safe), replay window, idempotency key → Redis `SETNX` + Mongo unique index. |
| `queue/connection.js` | Dedicated ioredis clients for BullMQ (`maxRetriesPerRequest: null`). |
| `queue/queue.js` | The single `agent-runs` queue. All three triggers enqueue here. |
| `queue/worker.js` | `Worker(..., { concurrency: 1 })` → `orchestrator.run(job)`. |
| `scheduler/cron.js` | node-cron; loads enabled `AgentTask`s with a `cronExpression`, enqueues. |
| **`sandbox/executor.js`** | **The core.** See notes below. |
| `sandbox/reaper.js` | On boot: list + force-remove containers labelled `codesync.agentrun`. |
| `sandbox/Dockerfile.agent-sandbox` | `node:20-alpine`, `adduser -u 1000`, no npm packages, `WORKDIR /workspace`. |
| `agent/orchestrator.js` | The loop: task → generate → write → execute → on failure feed `{code, stderr, exitCode}` back → retry, max 3. Persists **every** attempt via `$push` (never overwrites). Publishes events to Redis. |
| `agent/prompts.js` | Single versioned file. `PROMPT_VERSION` constant stamped onto each attempt. |
| `agent/gemini.client.js` | REST call (same shape as review.service), exponential backoff 1s/2s/4s/8s on 429, per-run call counter, audit log line per call. |
| `quota/limiter.js` | Token bucket, 6 req/min, **queues** on limit (never drops/errors). Redis daily counter, cap 200, resets midnight Pacific. |
| `quota/budget.js` | Per-run cap of 6 → `budget_exceeded` + persisted reason, no retry. |
| `artifacts/sinks/filesystem.js` | Default sink → `/artifacts/<runId>/`. |
| `artifacts/sinks/webhook.js` | Outbound POST. |
| `artifacts/sinks/github.js` | Octokit PR behind flag + token; **skips cleanly** if unset. |
| `artifacts/index.js` | Sink registry + Mongo metadata write. |
| `stream/pubsub.js` | Redis pub/sub bridge (`codesync:agentrun:<runId>`) so SSE works across instances. |
| `stream/sse.js` | SSE writer copied from the reviewer's pattern. |
| `demo/cache.js` | `DEMO_CACHE=true` → replay last successful run from Mongo, zero API calls. |
| `demo/seed-demo.js` | Seeds the two tasks (below). |
| `demo/demo.sh` | seed → fire webhook with valid HMAC → print run URL. |

#### `sandbox/executor.js` — design notes

- **Getting code into a read-only container with a tmpfs workspace.** `docker cp` before start
  writes to the image layer, which the tmpfs mount then *shadows* at start — so it silently doesn't
  work. Instead the container is created with
  `Cmd: ["/bin/sh","-c","echo <b64> | base64 -d > /workspace/main.js && exec node /workspace/main.js"]`.
  Args go through `exec`, so the limit is `ARG_MAX` (~2 MB); generated code is capped at 256 KB well
  below that. Same mechanism writes fixture files (the malformed CSV).
- **HostConfig** exactly as specified: `NetworkMode: "none"`, `ReadonlyRootfs: true`,
  `Tmpfs: { "/workspace": "rw,size=64m,mode=1777" }`, `Memory: 512*1024*1024`,
  `NanoCpus: 5e8`, `PidsLimit: 128`, `CapDrop: ["ALL"]`, `SecurityOpt: ["no-new-privileges"]`,
  `User: "1000:1000"`, `Privileged: false`, `AutoRemove: false` (we remove explicitly so we can read
  the exit code first).
- **Timeout:** `Promise.race` of `container.wait()` vs a 30 s timer → `container.kill()` → `timedOut: true`.
- **Output:** `container.attach({stream:true, stdout:true, stderr:true})` with **`demuxStream`** into
  separate buffers, hard-capped at 1 MB total with a `[output truncated]` marker; the writer stops
  appending past the cap so a log bomb can't grow the heap.
- **Cleanup:** `try/finally` with `container.remove({ force: true })` swallowing its own errors, plus
  the boot reaper for orphans.
- Returns `{ exitCode, stdout, stderr, durationMs, timedOut }`.

#### Artifacts out of a no-network, read-only container

Per-run **writable bind mount**: `<AGENT_ARTIFACTS_HOST_PATH>/<runId>` → `/workspace/out` (rw).
Because the runner talks to the *host* Docker daemon, the bind source must be a **host** path, not a
path inside the server container — so compose sets `AGENT_ARTIFACTS_HOST_PATH=${PWD}/artifacts`
while the server reads the same dir through its own `./artifacts:/app/artifacts` mount. Running the
server outside Docker, the two paths coincide and it just works. Documented in README + SECURITY.md.

### New tests — `server/tests/agent-runner/`

Existing jest config is `testMatch: ["**/tests/**/*.test.js"]`, so tests live with the other tests
(one directory, still a one-line delete in REMOVAL.md).

- `executor.test.js` — **timeout kills the container**, **cleanup runs on throw**, **1 MB output cap
  enforced**, **non-zero exit propagates**. Dockerode mocked for CI; a `describe.skipIf(no docker)`
  block runs the real thing locally.
- `orchestrator.test.js` — retry loop with a **mocked Gemini client**: fail→fail→succeed, all three
  attempts persisted, and max-attempts termination.
- `quota.test.js` — token bucket queues rather than drops; per-run budget → `budget_exceeded`; daily
  cap refuses new runs.
- `hmac.test.js` — bad signature 401, good signature 202, replayed idempotency key doesn't double-run.

### New frontend — `client/src/features/agent-runner/`

`routes.jsx` (lazy route element), `RunsPage.jsx`, `RunDetailPage.jsx`,
`components/{RunList,AttemptAccordion,CodeDiff,LiveLog,ArtifactList,TriggerRunButton}.jsx`,
`hooks/{useRuns,useRunStream}.js`, `api.js`.

- `useRunStream.js` mirrors `useReview.js` (fetch + reader, Bearer header), handling
  `status | log | attempt_start | attempt_result | artifact | done`.
- `CodeDiff.jsx` — line diff between attempt N and N+1. **No new dependency**: the repo already has
  [DiffViewer.jsx](client/src/components/DiffViewer.jsx); I'll follow its approach rather than add one.
- Styling matches the existing dark slate/sky Tailwind system (`animate-fade-up`, rounded panels).

### Docs

`SECURITY.md` (new), `REMOVAL.md` (new), `AGENT_RUNNER.md` (new — ASCII diagram + how to run),
`.env.agent-runner.example` (new).

---

## The four touch points

Each wrapped in `// AGENT_RUNNER_START` / `// AGENT_RUNNER_END`:

1. **[server/src/app.js](server/src/app.js)** — one line, after the existing `app.use("/api/review", …)`:
   ```js
   // AGENT_RUNNER_START
   require("./agent-runner").register(app);
   // AGENT_RUNNER_END
   ```
   With the flag off this returns immediately: no routes, no worker, no cron, no Redis clients,
   no Docker calls. Tests that `require("../src/app")` are unaffected.

2. **[client/src/App.jsx](client/src/App.jsx)** — needs **two** lines, not one: ESM can't
   `require()` inline, so it's one `import` + one `<Route>` (both inside one marker block).

3. **[docker-compose.yml](docker-compose.yml)** — one marker block on the `server` service:
   docker socket mount, `./artifacts` mount, `AGENT_ARTIFACTS_HOST_PATH`. Plus the sandbox image
   build. Realistically ~5 lines, not one.

4. **[server/package.json](server/package.json)** — `dockerode`, `bullmq`, `node-cron`, `@octokit/rest`.
   No version bumps to existing deps. Client gets **no** new deps.

---

## Gemini budget math (checking your numbers actually work)

The orchestrator asks for **plan + code in a single call** (one structured response), rather than a
separate planning call. So a run costs:

| Scenario | Calls |
| --- | --- |
| Happy path (succeeds attempt 1) | **1** |
| Self-correction demo (fails once, fixes) | **2** |
| Worst case (3 attempts, all corrections) | **3** |

Against a per-run budget of **6** that's 2× headroom, and at concurrency 1 a single run never
approaches the 6 req/min bucket. **No permission needed for a higher rate** — the defaults you gave
are sufficient. If a run ever does hit 6 calls it terminates as `budget_exceeded` rather than
burning the reviewer's quota, as specified.

---

## Demo tasks (Phase 7)

1. **Happy path** — "read `input.json`, sum the `amount` field, write `total.txt`". Succeeds attempt 1.
2. **Self-correction** — parse `messy.csv` which has **mixed `,` / `;` delimiters**, a row with a
   **trailing empty field**, and a row where a **denominator is `0`**. A naive first implementation
   (`split(",")` + divide) throws `TypeError` / emits `Infinity` and exits non-zero. Attempt 2 reads
   the real stderr and handles it. **The fixture makes the failure genuine — nothing is scripted**,
   and the CSV lives in the seeded task so the failure is reproducible rather than luck.

---

## Verification before I call it done

- `cd server && npm test` — full existing suite, flag **off** then **on**.
- Manual: editor loads, two browsers stay in Yjs sync, RAG reviewer streams — flag off and on.
- `docker compose up` cold start.
- Confirm `git diff` touches only the four files.

---

## ⚠️ Decisions I need from you

The isolation addendum and the feature spec genuinely conflict in five places. My recommended
default is listed first for each — reply "defaults are fine" and I'll proceed with all of them.

1. **README.** Phase 7 wants the diagram in `README.md`, but the addendum forbids editing existing
   files outside the four touch points.
   → *Default:* put it in a new `AGENT_RUNNER.md`, leave `README.md` untouched.
   *Alternative:* add a 5th touch point — one marker-wrapped link line in `README.md`.

2. **Nav entry.** The addendum allows "one lazy-loaded route **+ nav entry**" in the React router
   config — but the nav lives in `Dashboard.jsx`, a 5th file.
   → *Default:* route only; `/runs` reachable by URL, with its own back-link to the dashboard.
   *Alternative:* one marker-wrapped `<Link>` in `Dashboard.jsx`.

3. **Env vars.** `.env.example` is an existing file.
   → *Default:* new `.env.agent-runner.example`, documented as "append these to your `.env`".
   *Alternative:* marker-wrapped block appended to `.env.example`.

4. **Script locations.** Spec says `scripts/seed-demo.js` and `scripts/demo.sh` (repo root);
   addendum says all backend code under `src/agent-runner/`.
   → *Default:* real logic in `server/src/agent-runner/demo/`, with 2-line delegating wrappers at
   `scripts/`. Both paths satisfied, still deletes cleanly.

5. **Touch points 2 and 3 can't be literally one line** (ESM import; compose needs a mount + env +
   volume). → *Default:* keep each to one minimal marker-wrapped **block**, as small as possible.

One more thing worth flagging: mounting the Docker socket into the server container gives the runner
**root-equivalent control of the host daemon** — anything that achieves RCE in the API process can
start a privileged container and own the host. That's inherent to the design you specified, it will
be stated plainly in SECURITY.md, and it's the main reason the gVisor/Firecracker section isn't
hand-waving.
