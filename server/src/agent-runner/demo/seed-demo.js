const mongoose = require("mongoose");
const appConfig = require("../../config");
const AgentTask = require("../models/AgentTask");

/**
 * Seed the two demo tasks.
 *
 * Task 1 is a clean happy path. Task 2 is the self-correction demo, and its
 * failure is GENUINE rather than scripted: nothing forces a non-zero exit and
 * nothing in the prompt says which dependencies exist. The task simply needs
 * YAML parsed, Node has no stdlib YAML parser, and the sandbox has no packages —
 * so attempt 1 really does die with MODULE_NOT_FOUND and attempt 2 really does
 * have to read that stderr to recover.
 */

const HAPPY_PATH_INPUT = JSON.stringify(
  {
    orders: [
      { id: "A-1", amount: 125.5, currency: "USD" },
      { id: "A-2", amount: 89.99, currency: "USD" },
      { id: "A-3", amount: 240.0, currency: "USD" },
      { id: "A-4", amount: 15.25, currency: "USD" }
    ]
  },
  null,
  2
);

// INI, deliberately — Node has no INI parser in its standard library either, so
// `require("ini")` remains the honest first move and the MODULE_NOT_FOUND
// trigger is unchanged. Verified in agent-sandbox:node20: ini, iniparser,
// js-ini, config-ini-parser and properties-reader are all MODULE_NOT_FOUND.
//
// What changes is what happens AFTER the failure. YAML's indentation-based
// nesting made attempt 2 fail twice in a row for the same underlying reason:
// deciding which lines are children of which parent. Both times the parser
// exited 0 and emitted confident, wrong numbers — first counting `cluster` as a
// service, then counting `env` and `healthcheck` as services.
//
// INI has no nesting to get wrong. Sections are flat and delimited by [name],
// keys are unambiguous `k=v`, and the whole hand-roll is ~15 lines. The failure
// stays environmental; the recovery becomes achievable.
const SERVICES_INI = `; CodeSync deployment services
; each [service.<name>] block describes one deployable service

[service.api-gateway]
replicas=3
image=registry.internal/api-gateway:2.4.1
cpu=500m
memory=512Mi
env.NODE_ENV=production
env.LOG_LEVEL=info
env.TIMEOUT_MS=30000
healthcheck=/healthz

[service.worker]
replicas=5
image=registry.internal/worker:1.9.0
cpu=1000m
memory=1Gi
env.NODE_ENV=production
env.QUEUE_CONCURRENCY=4
healthcheck=

[service.scheduler]
replicas=1
image=registry.internal/scheduler:0.8.2
cpu=250m
memory=256Mi
env.NODE_ENV=production
healthcheck=/alive
`;

// Kept only so the previous fixture's rationale is not lost from the history.
// YAML, deliberately — because Node has NO YAML parser in its standard library.
//
// Two earlier fixture designs failed to make attempt 1 fail reliably:
//
//   1. A malformed CSV. The failure depended on the model being careless, so a
//      sufficiently defensive first attempt just succeeded. Probabilistic.
//   2. A valid but RFC 4180-heavy CSV (quoted commas, escaped quotes, embedded
//      newlines), on the theory that the complexity would provoke csv-parse.
//      Measured against the live model: it did not. Gemini hand-rolled a
//      character-level parser with only fs and path.
//
// YAML is different in kind. There is no stdlib option to fall back on, so
// `require("js-yaml")` is not laziness — it is what any competent engineer
// writes. Verified against the live model: the YAML task produces
// require("js-yaml") where the CSV task produced require("fs").
//
// That makes attempt 1 fail by ENVIRONMENT rather than by data. A missing
// dependency cannot be defended against by writing more careful code, so the
// first attempt fails no matter how good the model is — which is exactly the
// determinism the demo needs.
//
// Feature set sits in a specific window: rich enough that reaching for a library
// is the honest first move, but tractable enough that a focused indentation
// parser gets it RIGHT on attempt 2. Anchors, aliases, block scalars and flow
// style are omitted for that reason.
//
// `services` is a KEYED MAP, not a sequence of mappings. That is a measured
// decision, not a stylistic one. With `services:` as a list of `- name: x`
// items, attempt 2 recovered from MODULE_NOT_FOUND and exited 0 but produced
// semantically WRONG output (serviceCount 2 instead of 3, totalReplicas 1
// instead of 9): the hand-rolled parser mis-tracked where each list item began.
// Its own comments said it assumed "top-level keys are service names".
//
// Sequence-of-mappings is the single hardest thing to hand-roll in YAML, and a
// demo whose artifact is silently wrong is worse than one that fails loudly. A
// keyed map keeps this genuinely YAML — still no stdlib parser, so js-yaml is
// still the honest first reach — while being recoverable in one correction.
const DEPLOY_YAML = `version: 3
cluster:
  name: "prod-euw1"
  region: eu-west-1
  managed: true
services:
  api-gateway:
    replicas: 3
    image: "registry.internal/api-gateway:2.4.1"
    resources:
      cpu: 500m
      memory: 512Mi
    env:
      - NODE_ENV=production
      - LOG_LEVEL=info
      - TIMEOUT_MS=30000
    healthcheck:
      path: /healthz
      intervalSeconds: 10
  worker:
    replicas: 5
    image: "registry.internal/worker:1.9.0"
    resources:
      cpu: 1000m
      memory: 1Gi
    env:
      - NODE_ENV=production
      - QUEUE_CONCURRENCY=4
    healthcheck: null
  scheduler:
    replicas: 1
    image: "registry.internal/scheduler:0.8.2"
    resources:
      cpu: 250m
      memory: 256Mi
    env:
      - NODE_ENV=production
    healthcheck:
      path: /alive
      intervalSeconds: 30
`;

const TASKS = [
  {
    slug: "order-total",
    name: "Sum order amounts",
    description: "Happy path — succeeds on the first attempt.",
    prompt: `Read the JSON file at /workspace/orders.json. It contains an "orders" array,
where each order has an "amount" field.

Compute the total of all order amounts and the count of orders. Write the result
to /workspace/out/total.json as JSON with the shape:

  { "orderCount": <number>, "total": <number> }

Print the total to stdout as well.`,
    fixtures: [{ name: "orders.json", content: HAPPY_PATH_INPUT }],
    expectedArtifacts: ["total.json"],
    cronExpression: "",
    enabled: true
  },
  {
    slug: "self-correction-deps",
    name: "Summarise deployment services",
    description:
      "Self-correction demo — the natural solution requires an INI parser the sandbox does not have. Attempt 1 fails with MODULE_NOT_FOUND every time; the agent must read that stderr and rewrite using only what is present, then satisfy an exact-value validator.",
    // Says nothing about which dependencies are available. The task is an
    // ordinary, honest description of the data — it is the ENVIRONMENT that
    // refuses, and discovering that is the demo.
    //
    // The parsing RULES are stated precisely, though. Ambiguity about what
    // counts as a service is not part of the demo; the missing dependency is.
    // Leaving the rules vague produced confident wrong answers twice.
    prompt: `Read the INI file at /workspace/services.ini and summarise the services it declares.

Parse it with the "ini" npm package (require("ini")) — it handles INI comment and
quoting rules correctly, so do not hand-roll a parser.

Format rules for this file:
- Lines beginning with ';' are comments. Blank lines are ignored.
- A section header looks like [service.<name>] and declares ONE service whose
  name is the part after "service." — for example [service.api-gateway] declares
  the service "api-gateway".
- Inside a section, every line is "key=value".
- "replicas" is an integer.
- Any key beginning with "env." is one environment variable for that service.
- "healthcheck" has a value when the service has one. If its value is empty, the
  service has NO healthcheck.

Write /workspace/out/services-summary.json with exactly this shape:

  {
    "serviceCount": <number>,
    "totalReplicas": <number>,
    "services": [
      { "name": <string>, "replicas": <number>, "envCount": <number>, "hasHealthcheck": <boolean> }
    ]
  }

- serviceCount is the number of [service.*] sections.
- totalReplicas is the sum of every service's replicas.
- envCount is the number of "env." keys in that service's section.
- hasHealthcheck is true only when that service's healthcheck value is non-empty.
- List services in the order they appear in the file.

Print one line per service to stdout.`,
    fixtures: [{ name: "services.ini", content: SERVICES_INI }],
    expectedArtifacts: ["services-summary.json"],
    // Exact-value assertions checked against the produced artifact AFTER a
    // zero exit. Derived by hand from SERVICES_INI above:
    //   api-gateway  replicas 3, env NODE_ENV/LOG_LEVEL/TIMEOUT_MS = 3, hc "/healthz"  -> true
    //   worker       replicas 5, env NODE_ENV/QUEUE_CONCURRENCY    = 2, hc ""          -> false
    //   scheduler    replicas 1, env NODE_ENV                      = 1, hc "/alive"    -> true
    //   totalReplicas = 3 + 5 + 1 = 9
    validator: {
      artifactName: "services-summary.json",
      assertions: [
        { label: "serviceCount", path: "serviceCount", equals: 3 },
        { label: "totalReplicas", path: "totalReplicas", equals: 9 },
        { label: "services array length", path: "services.length", equals: 3 },

        { label: "api-gateway replicas", path: "services[api-gateway].replicas", equals: 3 },
        { label: "api-gateway envCount", path: "services[api-gateway].envCount", equals: 3 },
        { label: "api-gateway hasHealthcheck", path: "services[api-gateway].hasHealthcheck", equals: true },

        { label: "worker replicas", path: "services[worker].replicas", equals: 5 },
        { label: "worker envCount", path: "services[worker].envCount", equals: 2 },
        { label: "worker hasHealthcheck", path: "services[worker].hasHealthcheck", equals: false },

        { label: "scheduler replicas", path: "services[scheduler].replicas", equals: 1 },
        { label: "scheduler envCount", path: "services[scheduler].envCount", equals: 1 },
        { label: "scheduler hasHealthcheck", path: "services[scheduler].hasHealthcheck", equals: true }
      ]
    },
    cronExpression: "",
    enabled: true
  }
];

/**
 * Insert or update the demo tasks.
 * @returns {Promise<Object[]>} The seeded tasks.
 */
async function seedTasks() {
  const seeded = [];
  for (const spec of TASKS) {
    // Upsert so re-running the demo script is safe and does not accumulate
    // duplicate tasks.
    const task = await AgentTask.findOneAndUpdate({ slug: spec.slug }, spec, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    });
    seeded.push(task);
  }
  return seeded;
}

/**
 * Connect, seed, and report. Used by the CLI wrapper.
 * @returns {Promise<void>} Resolves when seeding completes.
 */
async function main() {
  await mongoose.connect(appConfig.mongoUri);
  const tasks = await seedTasks();

  // eslint-disable-next-line no-console
  console.log("Seeded agent tasks:");
  tasks.forEach((task) => {
    // eslint-disable-next-line no-console
    console.log(`  ${task.slug.padEnd(22)} ${task._id}  ${task.name}`);
  });

  await mongoose.disconnect();
}

module.exports = { seedTasks, main, TASKS, DEPLOY_YAML, HAPPY_PATH_INPUT };

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Seeding failed:", error.message);
    process.exit(1);
  });
}
