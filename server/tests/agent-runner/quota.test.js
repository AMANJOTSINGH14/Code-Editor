process.env.NODE_ENV = "test";
process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/test";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "test-access";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-refresh";
process.env.REDIS_URL = "";

const limiter = require("../../src/agent-runner/quota/limiter");
const { createRunBudget, BudgetExceededError } = require("../../src/agent-runner/quota/budget");
const gemini = require("../../src/agent-runner/agent/gemini.client");
const { TokenBucket } = limiter;

describe("agent-runner quota controls", () => {
  beforeEach(() => {
    limiter.resetForTest();
  });

  describe("token bucket", () => {
    it("grants up to capacity without delay", async () => {
      const bucket = new TokenBucket(3, 60000);
      const waits = [await bucket.acquire(), await bucket.acquire(), await bucket.acquire()];
      expect(waits).toEqual([0, 0, 0]);
    });

    it("queues rather than rejecting once capacity is reached", async () => {
      // The specified behaviour is "on limit, QUEUE the call and wait — never
      // drop, never error". A throwing limiter would fail a run and waste the
      // calls already spent on earlier attempts.
      const bucket = new TokenBucket(2, 200);

      await bucket.acquire();
      await bucket.acquire();

      const startedAt = Date.now();
      const waited = await bucket.acquire();
      const elapsed = Date.now() - startedAt;

      expect(waited).toBeGreaterThan(0);
      expect(elapsed).toBeGreaterThanOrEqual(150);
    });

    it("releases queued callers in FIFO order", async () => {
      const bucket = new TokenBucket(1, 120);
      const order = [];

      await bucket.acquire();
      await Promise.all([
        bucket.acquire().then(() => order.push("first")),
        bucket.acquire().then(() => order.push("second")),
        bucket.acquire().then(() => order.push("third"))
      ]);

      expect(order).toEqual(["first", "second", "third"]);
    });

    it("lets slots free up as the window slides", async () => {
      const bucket = new TokenBucket(2, 150);
      await bucket.acquire();
      await bucket.acquire();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await bucket.acquire()).toBe(0);
    });
  });

  describe("per-run budget", () => {
    it("allows exactly its limit then throws", () => {
      const budget = createRunBudget(3);
      expect(budget.consume()).toBe(1);
      expect(budget.consume()).toBe(2);
      expect(budget.consume()).toBe(3);
      expect(() => budget.consume()).toThrow(BudgetExceededError);
      expect(budget.used()).toBe(3);
    });

    it("reports remaining capacity", () => {
      const budget = createRunBudget(2);
      expect(budget.hasRemaining()).toBe(true);
      budget.consume();
      expect(budget.hasRemaining()).toBe(true);
      budget.consume();
      expect(budget.hasRemaining()).toBe(false);
    });

    it("carries a stable error code for persistence", () => {
      const budget = createRunBudget(1);
      budget.consume();
      try {
        budget.consume();
        throw new Error("should have thrown");
      } catch (error) {
        expect(error.code).toBe("BUDGET_EXCEEDED");
      }
    });
  });

  describe("daily cap", () => {
    it("keys on the Pacific calendar date", () => {
      // Resetting "at midnight Pacific" is achieved by keying on the Pacific
      // date — no scheduled job, nothing to miss if the process is down.
      // 2026-08-03T05:00:00Z is 2026-08-02 22:00 PDT, i.e. still the 2nd.
      expect(limiter.pacificDateKey(new Date("2026-08-03T05:00:00Z"))).toBe("2026-08-02");
      // 2026-08-03T08:00:00Z is 2026-08-03 01:00 PDT — past the rollover.
      expect(limiter.pacificDateKey(new Date("2026-08-03T08:00:00Z"))).toBe("2026-08-03");
    });

    it("handles the PST/PDT transition without offset arithmetic", () => {
      // January is PST (UTC-8): 08:00Z is 00:00 on the same day.
      expect(limiter.pacificDateKey(new Date("2026-01-15T08:00:00Z"))).toBe("2026-01-15");
      // July is PDT (UTC-7): 06:00Z is 23:00 the previous day.
      expect(limiter.pacificDateKey(new Date("2026-07-15T06:00:00Z"))).toBe("2026-07-14");
    });

    it("refuses calls past the cap and releases correctly", async () => {
      const config = require("../../src/agent-runner/config");
      const original = config.gemini.dailyCap;
      config.gemini.dailyCap = 3;

      try {
        expect((await limiter.reserveDailyCall()).allowed).toBe(true);
        expect((await limiter.reserveDailyCall()).allowed).toBe(true);
        expect((await limiter.reserveDailyCall()).allowed).toBe(true);

        const refused = await limiter.reserveDailyCall();
        expect(refused.allowed).toBe(false);
        expect(refused.used).toBe(3);
        expect(refused.cap).toBe(3);

        // A refusal must not consume a slot, or the counter would drift past the
        // cap on every rejected attempt.
        expect(await limiter.getDailyUsage()).toBe(3);

        await limiter.releaseDailyCall();
        expect((await limiter.reserveDailyCall()).allowed).toBe(true);
      } finally {
        config.gemini.dailyCap = original;
      }
    });
  });

  describe("429 classification", () => {
    it("reads the quota limit out of an error body", () => {
      const body =
        '{"error":{"code":429,"message":"Quota exceeded for metric: ... limit: 0, model: gemini-2.0-flash"}}';
      expect(gemini.parseQuotaLimit(body)).toBe(0);
    });

    it("treats limit:0 as permanent", () => {
      // Verified against the live API: gemini-2.0-flash returns exactly this.
      // The free tier allocates NO quota, so backoff can never succeed —
      // retrying just burns 15s per call before failing anyway.
      expect(gemini.isPermanentQuotaError("... limit: 0, model: gemini-2.0-flash")).toBe(true);
    });

    it("treats a positive limit as transient", () => {
      // A real rate limit — backoff against the SAME model is the right answer.
      expect(gemini.isPermanentQuotaError("... limit: 60, model: gemini-2.5-flash")).toBe(false);
      expect(gemini.isPermanentQuotaError("... limit: 1500 ...")).toBe(false);
    });

    it("treats an unparseable body as transient", () => {
      // Failing toward "retry" is safer than declaring a healthy model dead.
      expect(gemini.isPermanentQuotaError("rate limited")).toBe(false);
      expect(gemini.parseQuotaLimit("")).toBeNull();
    });

    it("uses the specified backoff schedule", () => {
      expect(gemini.BACKOFF_MS).toEqual([1000, 2000, 4000, 8000]);
    });
  });
});
