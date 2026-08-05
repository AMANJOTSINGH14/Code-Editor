const { EventEmitter } = require("events");
const config = require("../config");
const logger = require("../../utils/logger");
const { createConnection, isRedisConfigured } = require("../queue/connection");

/**
 * Run event bus.
 *
 * The worker and the API process are not necessarily the same process — and
 * with multiple server instances, the browser's SSE connection almost certainly
 * lands on a different instance than the worker executing the run. A local
 * EventEmitter alone would mean live logs work on one replica and silently show
 * nothing on the others.
 *
 * So events go through Redis pub/sub, with a local emitter as the fallback when
 * Redis is not configured (single-process dev) and as the local delivery path.
 */

// Local delivery. Also the entire mechanism when Redis is absent.
const localBus = new EventEmitter();
// SSE connections can outnumber the default cap of 10 during a demo.
localBus.setMaxListeners(0);

/** @type {import("ioredis")|null} */
let publisher = null;
/** @type {import("ioredis")|null} */
let subscriber = null;

// channel -> set of handlers, so one Redis subscription serves N local listeners.
const channelHandlers = new Map();

/**
 * Channel name for a run.
 * @param {string} runId - Run id.
 * @returns {string} Channel.
 */
function channelFor(runId) {
  return `${config.queue.prefix}:run:${runId}`;
}

/**
 * Lazily create the publishing connection.
 * @returns {import("ioredis")|null} Publisher or null.
 */
function getPublisher() {
  if (publisher) return publisher;
  if (!isRedisConfigured()) return null;
  publisher = createConnection("pubsub-pub");
  return publisher;
}

/**
 * Lazily create the subscribing connection.
 *
 * A connection in subscriber mode cannot issue normal commands, so this must be
 * separate from the publisher and from every other client.
 * @returns {import("ioredis")|null} Subscriber or null.
 */
function getSubscriber() {
  if (subscriber) return subscriber;
  if (!isRedisConfigured()) return null;

  subscriber = createConnection("pubsub-sub");
  subscriber.on("message", (channel, payload) => {
    const handlers = channelHandlers.get(channel);
    if (!handlers || !handlers.size) return;

    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    handlers.forEach((handler) => {
      try {
        handler(parsed);
      } catch (error) {
        logger.warn({ message: "Run event handler threw", error: error.message });
      }
    });
  });

  return subscriber;
}

/**
 * Publish a run event.
 *
 * Publishing must never break a run: if Redis is down the run still executes and
 * is still persisted — only the live view degrades. Everything here is
 * fire-and-forget.
 * @param {string} runId - Run id.
 * @param {string} event - Event name (status | log | attempt_start | attempt_result | artifact | done).
 * @param {Object} data - Event payload.
 * @returns {void}
 */
function publish(runId, event, data = {}) {
  const message = { runId, event, data, at: new Date().toISOString() };

  // Local first, so a same-process SSE client sees the event even if Redis is
  // unavailable or lagging.
  localBus.emit(channelFor(runId), message);

  const pub = getPublisher();
  if (!pub) return;

  pub.publish(channelFor(runId), JSON.stringify(message)).catch((error) => {
    logger.warn({ message: "Failed to publish run event", runId, event, error: error.message });
  });
}

/**
 * Subscribe to a run's events.
 * @param {string} runId - Run id.
 * @param {(message: Object) => void} handler - Event handler.
 * @returns {() => void} Unsubscribe function.
 */
function subscribe(runId, handler) {
  const channel = channelFor(runId);

  // Guards against double-delivery: an event published in this process reaches
  // the local bus directly AND comes back over Redis. Only the local path is
  // wired to the caller; the Redis path is used for events from OTHER processes,
  // which the local bus never sees.
  const seen = new Set();
  const dedupe = (message) => {
    const key = `${message.event}:${message.at}:${JSON.stringify(message.data)}`;
    if (seen.has(key)) return;
    seen.add(key);
    // Bound memory on a long-lived stream.
    if (seen.size > 500) seen.clear();
    handler(message);
  };

  localBus.on(channel, dedupe);

  const sub = getSubscriber();
  if (sub) {
    if (!channelHandlers.has(channel)) {
      channelHandlers.set(channel, new Set());
      sub.subscribe(channel).catch((error) => {
        logger.warn({ message: "Failed to subscribe to run channel", runId, error: error.message });
      });
    }
    channelHandlers.get(channel).add(dedupe);
  }

  return () => {
    localBus.off(channel, dedupe);
    const handlers = channelHandlers.get(channel);
    if (!handlers) return;
    handlers.delete(dedupe);
    if (handlers.size === 0) {
      channelHandlers.delete(channel);
      if (sub) sub.unsubscribe(channel).catch(() => {});
    }
  };
}

module.exports = { publish, subscribe, channelFor };
