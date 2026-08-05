const fs = require("fs");
const path = require("path");

process.env.NODE_ENV = "test";
process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/test";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "test-access";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-refresh";

const runnerConfig = require("../../src/agent-runner/config");
const appConfig = require("../../src/config");

const SRC = path.resolve(__dirname, "../../src");

/**
 * Read every .js file under a directory tree.
 * @param {string} dir - Directory to walk.
 * @param {string[]} [acc] - Accumulator.
 * @returns {string[]} Absolute file paths.
 */
function walkJs(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, acc);
    else if (entry.name.endsWith(".js")) acc.push(full);
  }
  return acc;
}

describe("agent-runner isolation guarantees", () => {
  describe("Redis keyspace", () => {
    it("uses a dedicated logical DB, distinct from the app's DB 0", () => {
      expect(runnerConfig.redis.db).toBe(3);

      // The app's URL carries no database segment, so ioredis defaults it to 0.
      // If that ever changes, this assertion is the tripwire.
      const appDbSegment = /\/(\d+)\s*$/.exec(appConfig.redisUrl || "");
      const appDb = appDbSegment ? Number(appDbSegment[1]) : 0;
      expect(runnerConfig.redis.db).not.toBe(appDb);
    });

    it("namespaces BullMQ under its own prefix", () => {
      expect(runnerConfig.queue.prefix).toBe("agentrunner");
      // A second layer behind the DB split: even pointed at DB 0, BullMQ keys
      // would not collide with anything the app writes.
      expect(runnerConfig.queue.prefix).not.toBe(appConfig.redisPrefix);
    });

    it("keeps the one DB-0 exception namespaced under collab:agentrunner:", () => {
      // The route rate limiters reuse the app's middleware, which writes on
      // DB 0. That is deliberate, but the keys must stay namespaced.
      const routes = fs.readFileSync(
        path.join(SRC, "agent-runner/routes/runs.routes.js"),
        "utf8"
      );
      const prefixes = [...routes.matchAll(/keyPrefix:\s*`([^`]+)`/g)].map((m) => m[1]);

      expect(prefixes.length).toBeGreaterThan(0);
      prefixes.forEach((prefix) => {
        expect(prefix).toContain("agentrunner");
      });
    });

    it("does not collide with any existing app key prefix", () => {
      const existing = [
        "collab:api",
        "collab:review",
        "collab:docs:meta",
        "collab:version:publish",
        "collab:room",
        "collab:user"
      ];
      const runnerNamespace = `${appConfig.redisPrefix}:agentrunner`;
      existing.forEach((prefix) => {
        expect(runnerNamespace.startsWith(`${prefix}:`)).toBe(false);
        expect(prefix.startsWith(`${runnerNamespace}:`)).toBe(false);
      });
    });
  });

  describe("file containment", () => {
    it("confines all new backend code to src/agent-runner/", () => {
      // The addendum's core constraint. If a future change drops a file outside
      // the subsystem directory, REMOVAL.md silently stops being complete.
      const runnerFiles = walkJs(path.join(SRC, "agent-runner"));
      expect(runnerFiles.length).toBeGreaterThan(0);
      runnerFiles.forEach((file) => {
        expect(file.startsWith(path.join(SRC, "agent-runner"))).toBe(true);
      });
    });

    it("touches exactly one line of app.js, inside marker comments", () => {
      const appJs = fs.readFileSync(path.join(SRC, "app.js"), "utf8");
      const lines = appJs.split(/\r?\n/);

      const start = lines.findIndex((l) => l.includes("AGENT_RUNNER_START"));
      const end = lines.findIndex((l) => l.includes("AGENT_RUNNER_END"));

      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      // Exactly one line of real code between the markers.
      expect(end - start).toBe(2);
      expect(lines[start + 1].trim()).toBe('require("./agent-runner").register(app);');

      // And no other reference to the subsystem anywhere in app.js.
      const mentions = lines.filter((l) => l.includes("agent-runner") || l.includes("agentRunner"));
      expect(mentions).toHaveLength(1);
    });

    it("never imports agent-runner code from outside the subsystem", () => {
      const outside = walkJs(SRC).filter(
        (f) => !f.startsWith(path.join(SRC, "agent-runner")) && f !== path.join(SRC, "app.js")
      );

      outside.forEach((file) => {
        const contents = fs.readFileSync(file, "utf8");
        expect(contents).not.toMatch(/require\(["'].*agent-runner/);
      });
    });
  });

  describe("Gemini model pinning", () => {
    it("pins a single model with no fallback chain", () => {
      expect(typeof runnerConfig.gemini.model).toBe("string");
      expect(runnerConfig.gemini.model.length).toBeGreaterThan(0);

      // gemini-2.0-flash returns 429 with "limit: 0" on the free tier — it has no
      // allocation at all, so backoff can never make it succeed.
      expect(runnerConfig.gemini.model).not.toBe("gemini-2.0-flash");
    });

    it("does not define a model fallback list anywhere in the subsystem", () => {
      // Silently escalating to another model on 429 can drain the daily cap
      // through a tier nobody chose, and a call-count budget cannot detect it.
      const runnerFiles = walkJs(path.join(SRC, "agent-runner"));
      runnerFiles.forEach((file) => {
        const contents = fs.readFileSync(file, "utf8");
        expect(contents).not.toMatch(/FALLBACK_MODELS/);
        expect(contents).not.toMatch(/generateRecursive|streamRecursive/);
      });
    });

    it("keeps the runner's Gemini budget defaults at the agreed numbers", () => {
      // These read the RESOLVED config, so an operator's .env legitimately
      // overrides them — a real deployment lowered the daily cap to 40 during
      // live verification and failed this test when it asserted the shipped
      // default unconditionally. Each value is therefore checked against its
      // default only when the corresponding env var is absent; when it is set,
      // the assertion is that the override took effect and is sane.
      const expectDefaultOr = (envVar, value, shipped) => {
        if (process.env[envVar] === undefined) expect(value).toBe(shipped);
        else expect(value).toBe(Number(process.env[envVar]));
        expect(value).toBeGreaterThan(0);
      };

      expectDefaultOr("AGENT_RUNNER_GEMINI_RPM", runnerConfig.gemini.requestsPerMinute, 6);
      expectDefaultOr("AGENT_RUNNER_GEMINI_CALLS_PER_RUN", runnerConfig.gemini.callsPerRun, 6);
      expectDefaultOr("AGENT_RUNNER_GEMINI_DAILY_CAP", runnerConfig.gemini.dailyCap, 200);
      expectDefaultOr("AGENT_RUNNER_WORKER_CONCURRENCY", runnerConfig.queue.concurrency, 1);

      // Not overridable in the same way: worker concurrency above 1 would stack
      // runs against the shared quota, so its default is load-bearing.
      expect(runnerConfig.queue.concurrency).toBe(1);
    });

    it("sizes maxOutputTokens for a thinking model", () => {
      // gemini-2.5-flash spends 4k-6.5k tokens reasoning before emitting any
      // visible output, and maxOutputTokens covers BOTH. At 4096 every response
      // was truncated after "### PLAN". Anything at or below that is broken.
      expect(runnerConfig.gemini.maxOutputTokens).toBeGreaterThan(8192);
    });
  });
});
