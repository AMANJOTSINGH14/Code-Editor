import { useCallback, useRef, useState } from "react";
import { getAccessToken } from "../services/api.js";

/**
 * Hook to stream AI review responses via SSE.
 * @returns {Object} Review state and controls.
 */
export function useReview() {
  const [reviewText, setReviewText] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const controllerRef = useRef(null);

  /**
   * Reset the review output.
   * @returns {void}
   */
  const reset = useCallback(() => {
    setReviewText("");
    setNotice("");
    setError("");
  }, []);

  /**
   * Start streaming a review.
   * @param {string} documentId - Document id.
   * @returns {Promise<void>} Resolves when streaming ends.
   */
  const startReview = useCallback(async (documentId) => {
    if (!documentId) return;

    reset();
    setLoading(true);

    const token = getAccessToken();
    const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:3001";

    controllerRef.current = new AbortController();

    try {
      const response = await fetch(`${apiBaseUrl}/api/review/stream?documentId=${documentId}`, {
        headers: {
          Authorization: token ? `Bearer ${token}` : ""
        },
        credentials: "include",
        signal: controllerRef.current.signal
      });

      if (!response.ok) {
        let msg = "Failed to start review.";
        try {
          const body = await response.json();
          msg = body?.error?.message || msg;
        } catch {
          // ignore parse error
        }
        setError(msg);
        setLoading(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const processChunk = (chunk) => {
        buffer += chunk;
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        parts.forEach((part) => {
          const lines = part.split("\n");
          let event = "message";
          let data = "";
          lines.forEach((line) => {
            if (line.startsWith("event:")) {
              event = line.slice(6).trim();
            }
            if (line.startsWith("data:")) {
              data += line.slice(5).trim();
            }
          });
          if (!data) return;
          try {
            const payload = JSON.parse(data);
            if (event === "notice") {
              setNotice(payload.notice || "");
            } else if (event === "done") {
              setLoading(false);
            } else if (event === "error") {
              setError(payload.message || "Review failed");
              setLoading(false);
            } else if (payload.text) {
              setReviewText((prev) => prev + payload.text);
            }
          } catch {
            // ignore malformed SSE data
          }
        });
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        processChunk(decoder.decode(value, { stream: true }));
      }

      setLoading(false);
    } catch (err) {
      if (err.name === "AbortError") {
        setLoading(false);
        return;
      }
      setError("Failed to connect to review service.");
      setLoading(false);
    }
  }, [reset]);

  /**
   * Stop the streaming review.
   * @returns {void}
   */
  const stopReview = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
    }
  }, []);

  return {
    reviewText,
    loading,
    notice,
    error,
    startReview,
    stopReview,
    reset
  };
}
