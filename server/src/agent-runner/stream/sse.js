const AgentRun = require("../models/AgentRun");
const logger = require("../../utils/logger");
const pubsub = require("./pubsub");

/**
 * Server-Sent Events for live run streaming.
 *
 * Mirrors the pattern the RAG reviewer already uses (review.service.js): write
 * the event-stream headers, guard every write behind an `res.on("close")` flag,
 * and frame as `event:` + `data:` lines. Matching it means the existing client
 * approach — fetch + body.getReader(), which the reviewer uses so it can send an
 * Authorization header that EventSource cannot — works here unchanged.
 *
 * Events: status | log | attempt_start | attempt_result | artifact | done
 */

// Terminal states. Once a run reaches one, the stream has nothing further to
// deliver and should end rather than hold a connection open indefinitely.
const TERMINAL = ["succeeded", "failed", "timeout", "budget_exceeded"];

// Proxies and load balancers commonly drop idle connections around 30-60s. A
// run can legitimately be silent longer than that while a Gemini call is queued
// behind the rate limiter, so a comment frame keeps the connection alive.
const HEARTBEAT_MS = 15000;

/**
 * Stream a run's events over SSE until it reaches a terminal state.
 * @param {string} runId - Run id.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Resolves when the stream ends.
 */
async function streamRun(runId, res) {
  let closed = false;
  let unsubscribe = null;
  let heartbeat = null;

  /**
   * Tear down every resource this stream holds, exactly once.
   * @returns {void}
   */
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (unsubscribe) unsubscribe();
  };

  res.on("close", cleanup);

  /**
   * Write one SSE frame.
   * @param {string|null} event - Event name.
   * @param {Object} data - Payload.
   * @returns {void}
   */
  const writeSse = (event, data) => {
    if (closed) return;
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    // Without this, nginx buffers the whole response and nothing is live.
    "X-Accel-Buffering": "no"
  });

  const run = await AgentRun.findById(runId).catch(() => null);
  if (!run) {
    writeSse("error", { message: "Run not found" });
    cleanup();
    res.end();
    return;
  }

  // Replay current state first. A client that connects mid-run — or after it
  // finished — must see what already happened, not just future events. Without
  // this, opening the page a second later shows an empty log for a run that is
  // half done.
  writeSse("status", { status: run.status });
  run.attempts.forEach((attempt) => {
    writeSse("attempt_start", { index: attempt.index, replay: true });
    if (attempt.exitCode !== null || attempt.timedOut) {
      writeSse("attempt_result", {
        index: attempt.index,
        exitCode: attempt.exitCode,
        timedOut: attempt.timedOut,
        durationMs: attempt.durationMs,
        stdout: attempt.stdout,
        stderr: attempt.stderr,
        replay: true
      });
    }
  });
  run.artifacts.forEach((artifact) => {
    writeSse("artifact", {
      name: artifact.name,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
      replay: true
    });
  });

  if (TERMINAL.includes(run.status)) {
    writeSse("done", {
      status: run.status,
      error: run.error && run.error.message ? run.error : null
    });
    cleanup();
    res.end();
    return;
  }

  // Subscribed only after the replay, so a live event cannot interleave into the
  // middle of the historical replay and arrive out of order.
  unsubscribe = pubsub.subscribe(runId, (message) => {
    if (closed) return;
    writeSse(message.event, message.data);

    if (message.event === "done") {
      cleanup();
      res.end();
    }
  });

  heartbeat = setInterval(() => {
    if (closed) return;
    // A comment frame: keeps intermediaries from dropping the connection while
    // being ignored by every SSE parser.
    res.write(": heartbeat\n\n");
  }, HEARTBEAT_MS);

  // An open stream must not by itself keep the event loop alive. The HTTP
  // server already holds the process up while it is listening, so without this
  // a lingering stream delays graceful shutdown (and hangs Jest).
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  logger.info({ message: "SSE stream opened for run", runId });
}

module.exports = { streamRun, TERMINAL, HEARTBEAT_MS };
