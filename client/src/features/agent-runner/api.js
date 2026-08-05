import api from "../../services/api.js";

/**
 * Agent Runner API calls.
 *
 * Uses the app's shared axios instance so auth headers, the 401 refresh
 * interceptor and the base URL all behave exactly as they do everywhere else.
 */

/**
 * Fetch recent runs.
 * @param {Object} [params] - Query params.
 * @returns {Promise<Object[]>} Run summaries.
 */
export async function fetchRuns(params = {}) {
  const response = await api.get("/api/runs", { params });
  return response.data.data.runs || [];
}

/**
 * Fetch one run with its full attempt history.
 * @param {string} runId - Run id.
 * @returns {Promise<Object>} Run detail.
 */
export async function fetchRun(runId) {
  const response = await api.get(`/api/runs/${runId}`);
  return response.data.data.run;
}

/**
 * Fetch available tasks.
 * @returns {Promise<Object[]>} Tasks.
 */
export async function fetchTasks() {
  const response = await api.get("/api/runs/tasks");
  return response.data.data.tasks || [];
}

/**
 * Trigger a run manually.
 * @param {string} taskId - Task id or slug.
 * @returns {Promise<Object>} Created run info.
 */
export async function triggerRun(taskId) {
  const response = await api.post("/api/runs", { taskId });
  return response.data.data;
}

/**
 * Build the download URL for an artifact.
 * @param {string} runId - Run id.
 * @param {string} name - Artifact filename.
 * @returns {string} Absolute URL.
 */
export function artifactUrl(runId, name) {
  const base = import.meta.env.VITE_API_URL || "http://localhost:3001";
  return `${base}/api/runs/${runId}/artifacts/${encodeURIComponent(name)}`;
}
