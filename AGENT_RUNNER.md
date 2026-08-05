# Agent Runner

An event-triggered agent that writes code, executes it inside an isolated
sandbox container, reads its own errors, and corrects itself — emitting real
files as output rather than chat text.

Built as an isolated subsystem inside CodeSync. It is off by default and can be
deleted in under two minutes (see [REMOVAL.md](REMOVAL.md)). Read
[SECURITY.md](SECURITY.md) before enabling it anywhere real.

---

## Architecture

```
   TRIGGERS                    QUEUE                    WORKER (concurrency 1)
┌────────────────────┐   ┌──────────────┐   ┌──────────────────────────────────┐
│ POST /trigger/:id  │   │              │   │  ORCHESTRATOR                    │
│   webhook + HMAC   │──▶│   BullMQ     │──▶│                                  │
│   idempotency key  │   │              │   │   ┌──────────────────────────┐   │
├────────────────────┤   │  Redis DB 3  │   │   │ 1. prompt ──▶ Gemini     │   │
│ POST /api/runs     │──▶│  prefix:     │   │   │    (pinned model, no     │   │
│   JWT authed       │   │  agentrunner │   │   │     fallback chain)      │   │
├────────────────────┤   │              │   │   └───────────┬──────────────┘   │
│ node-cron          │──▶│              │   │               ▼                  │
│   tick-locked      │   └──────────────┘   │   ┌──────────────────────────┐   │
└────────────────────┘                      │   │ 2. execute in sandbox    │   │
                                            │   └───────────┬──────────────┘   │
   QUOTA (4 independent limits)             │               ▼                  │
┌────────────────────────────────┐          │        exit 0 ?                  │
│ token bucket   6 req/min       │          │        │        │                │
│                (queues, FIFO)  │◀─────────│    yes │        │ no             │
│ worker conc.   1               │          │        ▼        ▼                │
│ per-run        6 calls         │          │   succeeded   3. feed REAL       │
│                → budget_exceeded          │               stderr + exit code │
│ daily          200 (midnight PT)          │               back ──▶ attempt+1 │
└────────────────────────────────┘          │               (max 3)            │
                                            └──────────────┬───────────────────┘
                                                           ▼
                            ┌──────────────────────────────────────────────┐
                            │  SANDBOX  agent-sandbox:node20               │
                            │                                              │
                            │  NetworkMode none    ReadonlyRootfs          │
                            │  tmpfs /workspace    noexec,nosuid,nodev     │
                            │  Memory 512m         MemorySwap 512m         │
                            │  NanoCpus 0.5        PidsLimit 128           │
                            │  CapDrop ALL         no-new-privileges       │
                            │  uid 1000            30s wall clock          │
                            │  output capped at 1MB (stdout+stderr shared) │
                            │                                              │
                            │  /workspace/out ──▶ bind ──▶ host artifacts  │
                            │                    (the one hole; SECURITY)  │
                            └──────────────────────┬───────────────────────┘
                                                   ▼
   PERSISTENCE                          ARTIFACT SINKS
┌──────────────────────────┐   ┌──────────────────────────────────┐
│ Mongo AgentRun           │   │ filesystem  (default, of record) │
│  attempts[]  ← appended, │   │ webhook     (HMAC-signed POST)   │
│    never overwritten     │   │ github PR   (flagged, optional)  │
│  artifacts[]             │   └──────────────────────────────────┘
│  geminiCalls[] (audit)   │
└──────────────────────────┘
             │
             ▼  Redis pub/sub  (so SSE works across replicas)
   GET /api/runs/:id/stream ──▶ status | log | attempt_start |
                                attempt_result | artifact | done
             │
             ▼
        /runs  UI — live logs, attempt accordion, code diff, downloads
```

---

## Quick start

### 1. Configure

```bash
cat .env.agent-runner.example >> .env
```

Then edit `.env`:

```bash
AGENT_RUNNER_ENABLED=true
AGENT_RUNNER_WEBHOOK_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
```

`GEMINI_API_KEY` must already be set (the RAG reviewer uses it too).

### 2. Build the sandbox image

```bash
docker build -f server/src/agent-runner/sandbox/Dockerfile.agent-sandbox \
             -t agent-sandbox:node20 .
```

### 3. Bring everything up

```bash
docker compose up
```

### 4. Run the demo

```bash
./scripts/demo.sh                  # self-correction demo
./scripts/demo.sh order-total      # happy path
```

Seeds the tasks, fires the webhook with a valid HMAC, and prints a run URL.

---

## The two demo tasks

**`order-total`** — sum a JSON array of order amounts, write `total.json`.
Succeeds on attempt 1. One Gemini call.

**`self-correction-deps`** — the interesting one. Parse `services.ini`, summarise
the services, write `services-summary.json`.

Node has **no INI parser in its standard library**, so the task tells the agent
to use the `ini` npm package. The sandbox ships no third-party packages and has
no network, so attempt 1 dies with `MODULE_NOT_FOUND` — **every time**.

```
attempt 1   require('ini')        →  Error: Cannot find module 'ini'   exit 1
attempt 2   hand-rolled parser    →  exit 0, 12/12 output checks pass
```

The failure comes from the **environment**, not from trick data: no amount of
careful coding avoids a dependency that is not installed. The orchestrator feeds
the **actual stderr** — not a summary — back to the model, which must diagnose it
and rewrite using only what is present.

Measured live: **5/5 runs failed attempt 1 with `MODULE_NOT_FOUND`, 6/6 produced
a correct artifact.**

### Why this fixture, and not the earlier ones

Two designs were tried and measured before this one:

| Fixture | Outcome |
| --- | --- |
| malformed CSV | failure depended on the model being careless — a defensive attempt just succeeded. Probabilistic. |
| valid RFC 4180 CSV | the theory was that quoting complexity would provoke `csv-parse`. It did not — the model hand-rolled a parser with `fs` alone. |
| YAML | trigger worked, but indentation nesting made attempt 2 produce **wrong values twice** while exiting 0. |
| **INI** | trigger works; flat sections mean the hand-roll is unambiguous and correct. |

### Output validation

A zero exit is necessary but not sufficient. Tasks may declare exact expected
values, checked against the produced artifact:

```js
validator: {
  artifactName: "services-summary.json",
  assertions: [
    { label: "totalReplicas", path: "totalReplicas", equals: 9 },
    { label: "worker envCount", path: "services[worker].envCount", equals: 2 }
  ]
}
```

A mismatch is treated exactly like a crash — the specific failures are fed back
and the agent retries. This exists because three separate live runs exited 0,
wrote valid JSON, and reported badly wrong numbers, and all three were recorded
as `succeeded`. The UI now shows a second badge (`✓ output verified` /
`✗ output wrong` / `unverified`) distinct from the status, because conflating
"it ran" with "it is right" is what let those three through.

Assertions resolve by **name** within arrays, not index — the agent chooses the
output order, and asserting position would fail a correct answer that sorted
differently.

---

## In the editor

Two tabs next to Chat / AI Review / Versions. AI Review is untouched.

### ▶ Run — costs no Gemini quota

Your buffer goes into the same hardened container the agent uses; you get the
real exit code, stdout and stderr. Verified live:

| Input | Result |
| --- | --- |
| working code | `exit 0` with output |
| `throw new Error(...)` | `exit 1` + real stack trace |
| `while(true){}` | killed at 30s, reported as a timeout |
| DNS lookup | `EAI_AGAIN` — no network exists |
| C++ | refused with a reason (the image is `node20`) |

### ✓ Verify — prove, then fix

This is the thing AI Review structurally cannot do: check whether its own claim
is true. Three steps, and the middle one is the point.

```
1. model names a defect AND writes a test that fails because of it
2. that test runs against YOUR ORIGINAL code
      exit != 0  → the bug is real, continue
      exit == 0  → the claim was imaginary; DISCARD it, report nothing
3. the fix runs against the SAME test — passing is the proof
```

Measured live on clean code, the model claimed a plausible defect in a `largest`
function; its own test passed, so the claim was thrown away rather than shown.
On genuinely buggy code (`i <= nums.length`, and `best = 0` breaking on
all-negative input) it found both, proved them with `AssertionError: NaN !== 20`,
and produced a fix that passed the same test — 1 call, 3.7s.

The test is frozen after the first cycle and reused verbatim on every fix
attempt. Letting the model edit it would let it "fix" the code by weakening the
check.

Bug, test and fix come from ONE call because they are one thought: a bug you
cannot write a failing test for is a guess, and a fix written without the test is
unverifiable.

> Both tabs are JavaScript-only — `agent-sandbox:node20` has no other toolchain.
> A `cpp` document gets an honest refusal, not a crash. Adding a language means
> adding an image and routing on `document.language`; nothing in the executor is
> Node-specific.

---

## API

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/api/runs/trigger/:taskId` | HMAC signature |
| `POST` | `/api/runs` | JWT |
| `GET` | `/api/runs` | JWT |
| `GET` | `/api/runs/tasks` | JWT |
| `GET` | `/api/runs/:id` | JWT |
| `GET` | `/api/runs/:id/stream` | JWT (SSE) |
| `GET` | `/api/runs/:id/artifacts/:name` | JWT |
| `GET` | `/api/runs/runtimes` | JWT |
| `POST` | `/api/runs/execute` | JWT |
| `POST` | `/api/runs/verify-fix` | JWT (SSE) |

`:taskId` accepts an ObjectId or a slug.

### Webhook signing

```
signature = HMAC-SHA256(secret, "v1:" + timestamp + ":" + rawBody)
```

```http
POST /api/runs/trigger/self-correction-deps
Content-Type: application/agent-runner+json
x-agentrunner-timestamp: 1754250000
x-agentrunner-signature: v1=<hex>
x-agentrunner-idempotency-key: delivery-123
```

> The content type is **required**. The app mounts `express.json()` globally,
> which consumes the request stream, and a signature verified against a
> re-serialised body is not a signature. `application/json` is rejected with 415
> rather than verified weakly. See SECURITY.md §5.

Returns **202** with a `runId` immediately — execution never blocks the caller.
A replayed delivery returns **200** with `replayed: true` and the original run.

---

## Run statuses

| Status | Meaning |
| --- | --- |
| `queued` | Accepted, waiting for the worker |
| `planning` | Asking the model for code |
| `executing` | Running in the sandbox |
| `retrying` | An attempt failed; requesting a correction |
| `succeeded` | Exit 0 |
| `failed` | Attempts exhausted, or an infrastructure fault |
| `timeout` | The final attempt hit the wall clock |
| `budget_exceeded` | Hit the per-run Gemini call budget. **Never retried** — the reason the budget exists |

---

## Gemini usage

Pinned to one model, **no fallback chain**. A chain that escalates on 429 can
drain the daily allowance through a tier nobody selected, and a budget counting
*calls* cannot detect it.

429 is not one condition:

- **429 with `limit > 0`** — transient. Back off 1s/2s/4s/8s against the same model.
- **429 with `limit: 0`** — no allocation exists. Fail loudly; backoff can never help.
- **404** — model unavailable. Fail loudly. Never substitute.

> `gemini-2.5-flash` and the whole 2.x family are 404 "no longer available to new users" on new projects; `gemini-2.0-flash` returns `429 limit: 0` on the free tier — listed
> by `ListModels`, but permanently unable to serve. The default is
> `gemini-2.5-flash`, which is what `.env` and the RAG reviewer already use.

A run costs **1 call** (happy path), **2** (one correction), or **3** (worst
case) against a per-run budget of 6 — plan and code come back in a single call.

`DEMO_CACHE=true` replays the last successful run from Mongo with no API call and
no container, so a live demo cannot fail on a rate limit. The replay is labelled
`DEMO_CACHE_REPLAY` in the run record and copies no `geminiCalls`, so it can
never be mistaken for a live execution.

---

## Tests

```bash
cd server && npm test
```

72 tests across 8 agent-runner suites, alongside the existing 130. Notable:

- **executor** — timeout kills the container, cleanup runs on throw, output cap
  enforced, non-zero exit propagates. Uses a real `docker-modem` so genuine
  8-byte stream demuxing is exercised.
- **orchestrator** — the retry loop against a mocked Gemini client:
  fail→fail→succeed, every attempt persisted, correction prompts carrying real
  stderr, budget/cap/pinned-model termination.
- **isolation** — asserts the `app.js` touch point is exactly one line, that no
  file outside `src/agent-runner/` imports into it, and that no model fallback
  chain exists anywhere in the subsystem.

---

## Configuration

Every value is env-overridable; see
[.env.agent-runner.example](.env.agent-runner.example) for the full list with
defaults and rationale.
