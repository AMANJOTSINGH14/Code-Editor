# Live verification — Agent Runner

> **This file has two sessions. Read the top one first.**
> The 2026-08-03 session below recorded several failures that have since been
> FIXED. It is kept rather than rewritten, because the sequence of wrong turns is
> the honest record of how the design arrived where it did.

---

# Session 2 — 2026-08-04 (current state)

New API key on a new Google Cloud project. Model pinned to
**`gemini-3.5-flash-lite`**.

## Everything fixed since session 1

| Session 1 finding | Status now |
| --- | --- |
| Self-correction trigger only 2/5 | **5/5** — INI fixture + the task naming the package |
| Artifact semantically WRONG (3 separate runs) | **6/6 correct**, hand-checked against the input |
| Nothing checked correctness | **validator added** — 12 exact assertions, mismatch is a correctable failure |
| `maxOutputTokens 4096` truncated every response | **16384**, plus explicit `MAX_TOKENS` detection |
| `task.description` leaked the demo into the prompt | **removed** from the prompt entirely |
| Correction prompt assumed all failures were data-shaped | **three failure classes**: missing module, crash, wrong output |
| DEMO_CACHE served artifacts that 404'd | **files copied**; replays never source another replay |

## Model availability — a third variant of the same trap

`ListModels`, the AI Studio rate-limit page, and `countTokens` all report models
that `generateContent` refuses. Only a real generation call proves availability.

| Model | Listed | `countTokens` | `generateContent` |
| --- | --- | --- | --- |
| `gemini-2.0-flash` | yes | 200 | **429 `limit: 0`** — no free-tier allocation |
| `gemini-2.5-flash` | yes | 200 | **404** — closed to new projects |
| `gemini-2.5-flash-lite` | yes | 200 | **404** — closed to new projects |
| `gemini-3.5-flash-lite` | yes | 200 | **200** ✅ |

The whole 2.x family is legacy-locked to projects that used it before the
cutoff. The pinned-model design handled this exactly as intended: failed loudly
with `MODEL_UNAVAILABLE`, never substituted, cost 1 call each.

## Self-correction demo — PASS

```
attempt-1 MODULE_NOT_FOUND : 5/5
validated true             : 6/6
artifact hand-checked      : 6/6 CORRECT
```

Seven runs produced **seven different programs** (distinct SHA-256, 2888–4071
chars) — the agent writes fresh code each time; only the *outcome* repeats.

## Editor integration — PASS

| Feature | Verified |
| --- | --- |
| **Run** — `POST /api/runs/execute` | exit 0 / crash+stack / 30s timeout / `EAI_AGAIN` / C++ refused |
| **Verify** — `POST /api/runs/verify-fix` on buggy code | found 2 planted bugs, proved via `NaN !== 20`, fixed, 1 call, 3.7s |
| **Verify** on CLEAN code | claimed a bug, **its own test passed, claim discarded** |

That last row is the point of the feature: a reviewer that can be caught being
wrong, and is.

## Suite

**23 suites / 233 tests, 0 failures.** Includes 10 validator tests, one of which
replays the exact wrong output a live run produced.

## Still unverified

1. Cron trigger — never exercised.
2. Webhook and GitHub artifact sinks — only the filesystem sink has run.
3. Multi-instance SSE over Redis pub/sub — only ever one server instance.
4. `budget_exceeded` terminal status — unit-tested only, never hit live.
5. Worker killed mid-run with a live container (the reaper was proven against a
   planted orphan, which is the same code path but not the same event).
6. Any language other than JavaScript — the sandbox image is `node20`.

---

# Session 1 — 2026-08-03

Real Gemini, real Docker, real Redis, real Mongo. Run 2026-08-03 (Pacific).

Nothing below is marked green that was not directly observed. Where something
could not be verified it says so and why.

---

## Summary

| Step | Result |
| --- | --- |
| 0 — Budget guard + `budget-report.js` | **PASS** |
| 1 — Infra up, routes registered | **PASS** |
| 2 — First live run (happy path) | **PASS** |
| 3 — Deterministic `MODULE_NOT_FOUND` fixture | **PARTIAL** — trigger works 2/2; ran 2 of 5 required; artifact semantically wrong |
| 4 — DEMO_CACHE replay | **PASS** — after fixing two bugs it exposed |
| 5 — Stability | **PARTIAL** — reaper, leak, queue, isolation verified; 3 back-to-back live runs blocked |
| 6 — UI screenshots | **PASS** |
| 7 — This report | **PASS** |

**Gemini calls consumed: 31 of the 40 cap.** Stopped at the 30-call stop line.

---

## The finding that dominates everything else

**Google's free tier allows only 20 `generate_content` requests per day for
`gemini-2.5-flash`.** Observed directly:

```
429 ... Quota exceeded for metric:
generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20
```

The 40-call cap was never the binding constraint — Google's 20/day was. Steps 3
and 5 ran out of real quota before they ran out of budget. This is the single
most important operational fact about the system: **the agent runner can perform
roughly 6–10 live runs per day on this key**, and the RAG reviewer shares that
same 20.

This also validated the 429 classification live, which is the behaviour that
matters most:

| Model | Response | Classified | Behaviour |
| --- | --- | --- | --- |
| `gemini-2.0-flash` | 429, `limit: 0` | permanent | fail loudly, no retry |
| `gemini-2.5-flash` | 429, `limit: 20` | transient | backoff 1s/2s/4s/8s, **same model**, then fail |

Never substituted a model. That is the exact distinction that was designed in and
it held under real conditions.

---

## Step 0 — Budget guard

**PASS.**

The three variable names in the request do not exist in the config. Zod strips
unknown keys silently, so setting them verbatim would have left the daily cap at
its default of 200 while appearing configured:

| Requested | Actual name |
| --- | --- |
| `AGENT_RUNNER_DAILY_CAP` | `AGENT_RUNNER_GEMINI_DAILY_CAP` |
| `AGENT_RUNNER_PER_RUN_BUDGET` | `AGENT_RUNNER_GEMINI_CALLS_PER_RUN` |
| `AGENT_RUNNER_RPM` | `AGENT_RUNNER_GEMINI_RPM` |

Loaded and confirmed live: cap 40, per-run 6, RPM 6, concurrency 1, max attempts 3.

**Pinned model string: `"gemini-2.5-flash"`.**

`scripts/budget-report.js` reads the authoritative Redis counter and reconciles
it against Mongo's per-run audit. Baseline at start: **0/40**.

---

## Step 1 — Infra

**PASS.** `docker compose up -d --build`: mongo (healthy), redis (healthy),
chromadb, server, client.

- `/health` → `{"status":"ok","mongo":"connected","redis":"connected"}`
- Boot log: `Agent runner registered` — mount `/api/runs`, redisDb 3, prefix
  `agentrunner`, image `agent-sandbox:node20`, model `gemini-2.5-flash`
- `Agent runner worker started`, concurrency **1**
- `Sandbox reaper found no orphans`
- Routes return **401** (registered + auth-guarded), not 404
- Docker socket reachable from inside the server container: **API v29.2.0**
- Sandbox image contains no third-party packages — global `node_modules` is
  `corepack` and `npm` only; `csv-parse`, `csv-parser`, `axios`, `lodash`,
  `papaparse`, `node-fetch`, `fast-csv` all `MODULE_NOT_FOUND`

---

## Step 2 — First live run

**PASS.** Task `order-total`, run `6a7150e747016c781db09c71`.

| | |
| --- | --- |
| Webhook | **HTTP 202**, returned immediately |
| BullMQ | picked up, jobId == runId |
| Gemini | 1 call, `gemini-2.5-flash`, 7925 ms, 396→619 tokens, 0 retries |
| Sandbox | `exitCode 0`, 724 ms, not timed out |
| Artifact | `artifacts/<runId>/total.json`, 40 B |
| Total | 8935 ms, 1 attempt |
| Leaked containers | 0 |

Artifact contents, independently checked for arithmetic (not just shape):

```json
{ "orderCount": 4, "total": 470.74 }
```

`125.50 + 89.99 + 240.00 + 15.25 = 470.74`. **Correct.**

---

## Step 3 — Deterministic failure fixture

**PARTIAL.** The mechanism works and was observed repeatedly. The required 5 runs
were not completed, and the artifact is not semantically correct.

### What was achieved

Three fixture designs were tried. The first two did not produce deterministic
failure, and that is worth recording because both are plausible-sounding:

1. **Malformed CSV** — failure depended on the model being careless. A defensive
   first attempt simply succeeded. Probabilistic, not deterministic.
2. **Valid RFC 4180 CSV** (quoted commas, escaped quotes, embedded newlines) — the
   theory was that the complexity would provoke `csv-parse`. Measured against the
   live model: **it did not.** Gemini hand-rolled a character-level parser using
   only `fs` and `path`.
3. **YAML** — Node has no stdlib YAML parser, so `require("js-yaml")` is the
   honest engineering choice rather than laziness. Probed live before committing:
   the YAML task produced `require('js-yaml')` where the CSV task produced
   `require('fs')`.

With design 3 the failure comes from the **environment**, not from trick data. A
missing dependency cannot be defended against by writing more careful code.

**Observed: 2/2 runs failed attempt 1 with `Cannot find module 'js-yaml'`, and
2/2 recovered by attempt 2.** Attempt 2's plan, unprompted:

> "The previous attempt failed because the `js-yaml` module was not found, and the
> environment does not allow installing new packages. The core issue is the need
> to parse YAML without a dedicated library."

That is genuine self-correction driven by real stderr.

### Three bugs this step exposed

**1. `maxOutputTokens` did not account for thinking tokens.** `gemini-2.5-flash`
is a thinking model and `maxOutputTokens` covers reasoning *and* the answer. At
4096, every call spent ~3930 tokens thinking and emitted ~162 visible tokens —
truncating after `### PLAN`, before the code fence. Surfaced as the far more
confusing "could not extract code from the model response". Four runs were lost
to this. Fixed: default 16384, `finishReason: MAX_TOKENS` now raises an explicit
`ResponseTruncatedError`, and `thoughtTokens` is recorded per call.

**2. The task `description` field leaked the entire demo into the prompt.**
`buildInitialPrompt` interpolated `task.description`, which read *"the natural
solution requires js-yaml, which the sandbox does not have… fails with
MODULE_NOT_FOUND"*. The model was handed the answer and attempt 1 passed. Fixed:
`description` is operator-facing UI metadata and is no longer sent to the model.

**3. The correction prompt assumed every failure was data-shaped.** Its guidance
was *"if the data is malformed… if a value can be zero"*, written for the earlier
CSV fixture. Against a missing-module error the model kept re-requiring the same
absent package and the loop could not converge. Fixed: correction guidance is now
root-cause agnostic and states that the environment cannot be changed. This is
shown only *after* a real failure whose stderr already revealed it, so it is not a
spoiler.

### What is NOT verified

- **Only 2 runs, not the required 5.** The remaining runs hit Google's 20/day
  ceiling and failed with 429 before generating anything.
- **The artifact is semantically wrong.** Both successful runs exited 0 but
  produced `serviceCount 2 / totalReplicas 1` against an expected `3 / 9`. The
  hand-rolled parser mis-tracked `services:` as a sequence of mappings — its own
  comments said it assumed "top-level keys are service names". **Exit 0 does not
  mean correct, and nothing in the pipeline checks correctness.**
- **The fix for that is written but unverified.** `services` was reshaped from a
  sequence of mappings to a keyed map — the single hardest YAML construct to
  hand-roll, removed deliberately. **No live run has yet used the reshaped
  fixture**; quota ran out first.

---

## Step 4 — DEMO_CACHE

**PASS**, after fixing two bugs it exposed. Verified with `DEMO_CACHE=true`:

| Check | Result |
| --- | --- |
| Gemini calls consumed | **0** (Redis counter 31 → 31, unchanged) |
| Run status | `succeeded`, 2 attempts, `geminiCalls: []` |
| Labelled as a replay | `DEMO_CACHE_REPLAY` — *"not a live execution"* |
| Duration | 61 ms (impossible with an API call) |
| SSE event sequence | identical to a live run |
| Artifact download | **HTTP 200** with real bytes |

SSE captured over real HTTP with a real Bearer token:

```
status → attempt_start → attempt_result → attempt_start → attempt_result → artifact → done
```

### Two bugs found here

**1. Replay copied artifact metadata but not the files.** The run advertised
`deploy-summary.json`, the UI rendered a Download button, and the route 404'd —
the bytes were still under the source run's directory. This is exactly the
failure DEMO_CACHE exists to prevent, so it must not be the thing that breaks the
demo. Fixed: files are copied, and only artifacts whose bytes actually arrived
are advertised.

**2. Replays chained off replays.** The source was "newest succeeded run", which
is often itself a replay — so each generation copied from a record whose bytes
were never on disk, degrading to an empty artifact list. Observed live. Fixed:
the source must be a genuine live run (`error.code != DEMO_CACHE_REPLAY` and
`geminiCalls` non-empty).

> Note: the replayed artifact contents are semantically wrong, because it is
> faithfully replaying a run made against the pre-fix fixture. The replay
> mechanism is correct; its source data carries Step 3's defect.

---

## Step 5 — Stability

**PARTIAL.**

Verified:

| Check | Result |
| --- | --- |
| Leaked sandbox containers after ~20 runs | **0** |
| Boot reaper | planted `codesync.agentrun=fake-orphan-test`, restarted server → `"Reaped orphaned sandbox container"`, `removed: 1` |
| BullMQ queue drains | waiting 0, active 0, delayed 0 |
| Artifact collisions | none — every run has its own `artifacts/<runId>/` |
| Redis keyspace isolation | every runner key under `agentrunner:` on **DB 3**; app keys untouched on DB 0 |

**Not verified:** the 3 back-to-back live runs. Google's daily quota was exhausted,
so any further live run fails at the first Gemini call and would test nothing.

**Not verified:** killing the worker *mid-run* specifically. The reaper was proven
against a planted orphan, which exercises the same code path, but a real
mid-execution kill (container alive, worker dies) was not performed.

**Observed side effect worth noting:** 3 of 8 artifact directories are empty.
`buildSandboxBinds` creates the directory before the container starts, so runs
that fail during generation leave an empty directory behind. Harmless, but
nothing prunes them.

---

## Step 6 — UI

**PASS.** Playwright 1.60.0 + Chromium, headless, against the running stack.
Screenshots in `./verification/`:

| File | Shows |
| --- | --- |
| `01-run-list.png` | run list — status badges, trigger source, attempts/artifacts/calls/duration |
| `02-trigger-control.png` | task picker + Trigger run |
| `03-run-detail-live-log.png` | run detail |
| `04-attempt-accordion.png` | attempt accordion |
| `05-attempt-diff.png` | **attempt 1 vs 2 diff** + artifacts panel |
| `06-artifacts.png` | artifacts panel |
| `downloaded-deploy-summary.json` | artifact fetched over HTTP |

`05-attempt-diff.png` is the important one. It shows, in one frame: the
`DEMO_CACHE_REPLAY` banner, `0 Gemini calls`, attempt 1 `exit 1` / attempt 2
`exit 0`, attempt 2's plan diagnosing the missing module, and the Monaco diff with
the removed line

```js
const yaml = require('js-yaml'); // Assuming js-yaml is available in the Node.js 20 environment
```

against the added hand-rolled `parseSimpleYaml()`.

**Console errors:** one — `Failed to load resource: 404`. Benign
(`/vite.svg` favicon), unrelated to the runner.

**Honest caveats:**
- `03`/`04` are byte-identical, as are `05`/`06` — the accordion was already
  expanded and the artifacts panel already visible, so those clicks changed
  nothing. Six files, four distinct views.
- The Live Log panel reads *"Waiting for the run to start…"* because a
  DEMO_CACHE replay finishes in 61 ms, before the SSE connection opens. Live
  streaming **was** verified separately over raw HTTP (Step 4); it has **not**
  been seen populating in the browser during a slow live run.
- The in-browser download click did not fire Playwright's download event. The
  route itself was verified directly: **HTTP 200** with correct bytes, plus
  `nosniff`, `Content-Disposition: attachment`, and a traversal attempt
  (`..%2F..%2Fpackage.json`) correctly refused with 404.

---

## Regression check

**PASS — 22 suites, 223 tests, 0 failures** after every fix above.

The fixes touched `prompts.js`, `gemini.client.js`, `config.js`, `AgentRun.js`,
`orchestrator.js` and `demo/cache.js`. One new test asserts `maxOutputTokens` is
sized for a thinking model, so the truncation bug cannot silently return.

One test had to be corrected rather than the code: `isolation.test.js` asserted
the *shipped* daily-cap default (200) while reading the *resolved* config, so it
failed the moment a real deployment lowered the cap to 40. It now checks each
value against its default only when the env var is absent, and against the
override otherwise — the assertion it was always meant to make.

---

## Everything still unverified

1. **5-run determinism** — only 2 of the required 5. `MODULE_NOT_FOUND` on attempt
   1 was 2/2 and recovery 2/2, but that is a sample of two.
2. **Semantic correctness of the self-correction artifact** — currently **wrong**.
   The reshaped keyed-map fixture is expected to fix it and has never been run.
3. **3 back-to-back stability runs.**
4. **Worker killed mid-run** with a live container.
5. **Live SSE streaming in the browser** during a slow run.
6. **In-browser artifact download** via a real download event.
7. **Cron trigger** — never exercised; no task carries a `cronExpression`.
8. **Webhook and GitHub artifact sinks** — never exercised; only the filesystem
   sink has run.
9. **Multi-instance SSE** over Redis pub/sub — only ever one server instance.
10. **Rate-limiter queueing under real contention** — the 6/min bucket never
    saturated, because Google's own limit bound first.
11. **`budget_exceeded` terminal status** — never triggered live; unit-tested only.

## To finish this

Google's quota resets daily. With ~20 calls/day, the remaining work needs roughly
two more days, or a billing-enabled key:

- **Day 1 (~14 calls):** 5 runs of `self-correction-deps` against the reshaped
  fixture, asserting `MODULE_NOT_FOUND` on attempt 1 **and** semantic correctness
  of `deploy-summary.json` (`serviceCount 3`, `totalReplicas 9`, envCounts
  `[3,2,1]`, healthchecks `[true,false,true]`).
- **Day 2 (~6 calls):** 3 back-to-back stability runs, a mid-run worker kill, and
  a browser capture of live SSE against a genuinely slow run.

The single highest-value fix, independent of quota: **the pipeline has no notion
of a correct result.** A run that exits 0 while emitting nonsense is recorded as
`succeeded`. Adding an optional per-task validator — a JSON Schema or an assertion
script run against the artifact — would turn "the process completed" into "the
output is right", and would have caught the Step 3 defect automatically instead of
by manual inspection.
