const config = require("../config");

/**
 * Per-run Gemini call budget.
 *
 * Bounds a single run's consumption so one pathological run cannot eat the
 * shared daily allowance. Exceeding it is terminal: the run is marked
 * `budget_exceeded` with the reason persisted, and is NOT retried — retrying is
 * exactly the behaviour the budget exists to prevent.
 */

/**
 * Raised when a run tries to exceed its call budget.
 */
class BudgetExceededError extends Error {
  /**
   * @param {number} limit - The per-run call limit.
   */
  constructor(limit) {
    super(`Run exceeded its Gemini call budget of ${limit} calls`);
    this.name = "BudgetExceededError";
    this.code = "BUDGET_EXCEEDED";
    this.limit = limit;
  }
}

/**
 * Raised when the global daily cap is reached.
 *
 * Distinct from BudgetExceededError because the remedy differs: a per-run
 * overrun is this run's fault, while a daily cap means no run should start at
 * all until the Pacific-midnight rollover.
 */
class DailyCapExceededError extends Error {
  /**
   * @param {number} used - Calls already used today.
   * @param {number} cap - The daily cap.
   */
  constructor(used, cap) {
    super(
      `Daily Gemini call cap reached (${used}/${cap}). ` +
        "Refusing new runs until the counter resets at midnight Pacific."
    );
    this.name = "DailyCapExceededError";
    this.code = "DAILY_CAP_EXCEEDED";
    this.used = used;
    this.cap = cap;
  }
}

/**
 * Create a call budget for one run.
 * @param {number} [limit] - Max calls. Defaults to config.
 * @returns {Object} Budget handle.
 */
function createRunBudget(limit = config.gemini.callsPerRun) {
  let used = 0;

  return {
    /**
     * Reserve one call.
     * @returns {number} The call number just consumed.
     * @throws {BudgetExceededError} When the budget is exhausted.
     */
    consume() {
      if (used >= limit) throw new BudgetExceededError(limit);
      used += 1;
      return used;
    },

    /**
     * Whether another call would be permitted.
     * @returns {boolean} True when budget remains.
     */
    hasRemaining() {
      return used < limit;
    },

    /**
     * Calls used so far.
     * @returns {number} Used count.
     */
    used() {
      return used;
    },

    /**
     * The configured limit.
     * @returns {number} Limit.
     */
    limit() {
      return limit;
    }
  };
}

module.exports = {
  createRunBudget,
  BudgetExceededError,
  DailyCapExceededError
};
