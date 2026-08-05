import { useCallback, useEffect, useRef, useState } from "react";
import { getAccessToken } from "../../../services/api.js";

/**
 * Subscribe to a run's SSE stream.
 *
 * Mirrors useReview.js: fetch + body.getReader() rather than EventSource,
 * because EventSource cannot send an Authorization header and the runs stream is
 * JWT-protected like every other authed route.
 *
 * @param {string} runId - Run id, or falsy to stay idle.
 * @returns {Object} Live stream state.
 */
export function useRunStream(runId) {
  const [status, setStatus] = useState("");
  const [logs, setLogs] = useState([]);
  const [attempts, setAttempts] = useState({});
  const [artifacts, setArtifacts] = useState([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const controllerRef = useRef(null);

  /**
   * Apply one SSE frame to local state.
   * @param {string} event - Event name.
   * @param {Object} payload - Event payload.
   * @returns {void}
   */
  const applyEvent = useCallback((event, payload) => {
    if (event === "status") {
      setStatus(payload.status);
    } else if (event === "log") {
      setLogs((prev) => [...prev, { message: payload.message, level: payload.level || "info" }]);
    } else if (event === "attempt_start") {
      setAttempts((prev) => ({
        ...prev,
        [payload.index]: { ...(prev[payload.index] || {}), index: payload.index, running: true }
      }));
    } else if (event === "attempt_result") {
      setAttempts((prev) => ({
        ...prev,
        [payload.index]: {
          ...(prev[payload.index] || {}),
          index: payload.index,
          running: false,
          exitCode: payload.exitCode,
          timedOut: payload.timedOut,
          durationMs: payload.durationMs,
          stdout: payload.stdout,
          stderr: payload.stderr
        }
      }));
    } else if (event === "artifact") {
      // The stream replays existing artifacts on connect, so guard against
      // showing the same file twice when reconnecting mid-run.
      setArtifacts((prev) =>
        prev.some((a) => a.name === payload.name) ? prev : [...prev, payload]
      );
    } else if (event === "done") {
      setDone(true);
      if (payload.status) setStatus(payload.status);
      if (payload.error && payload.error.message) setError(payload.error.message);
    } else if (event === "error") {
      setError(payload.message || "Stream error");
      setDone(true);
    }
  }, []);

  useEffect(() => {
    if (!runId) return undefined;

    setStatus("");
    setLogs([]);
    setAttempts({});
    setArtifacts([]);
    setDone(false);
    setError("");

    const controller = new AbortController();
    controllerRef.current = controller;
    let cancelled = false;

    (async () => {
      const token = getAccessToken();
      const base = import.meta.env.VITE_API_URL || "http://localhost:3001";

      try {
        const response = await fetch(`${base}/api/runs/${runId}/stream`, {
          headers: { Authorization: token ? `Bearer ${token}` : "" },
          credentials: "include",
          signal: controller.signal
        });

        if (!response.ok) {
          setError("Failed to open the run stream.");
          return;
        }

        setConnected(true);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone || cancelled) break;

          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() || "";

          blocks.forEach((block) => {
            // Heartbeats are comment frames with no data line.
            if (!block.includes("data:")) return;

            let event = "message";
            let data = "";
            block.split("\n").forEach((rawLine) => {
              if (rawLine.startsWith("event:")) event = rawLine.slice(6).trim();
              if (rawLine.startsWith("data:")) data += rawLine.slice(5).trim();
            });
            if (!data) return;
            try {
              applyEvent(event, JSON.parse(data));
            } catch {
              // Ignore a malformed frame; the next read completes it.
            }
          });
        }
      } catch (err) {
        if (err.name !== "AbortError" && !cancelled) {
          setError("Lost connection to the run stream.");
        }
      } finally {
        setConnected(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [runId, applyEvent]);

  return {
    status,
    logs,
    attempts: Object.values(attempts).sort((a, b) => a.index - b.index),
    artifacts,
    done,
    error,
    connected
  };
}
