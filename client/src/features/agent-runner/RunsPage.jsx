import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { fetchRuns } from "./api.js";
import StatusBadge from "./components/StatusBadge.jsx";
import TriggerRunButton from "./components/TriggerRunButton.jsx";

const LIVE_STATUSES = ["queued", "planning", "executing", "retrying"];

/**
 * Run list page.
 * @returns {JSX.Element} Runs page.
 */
export default function RunsPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      setRuns(await fetchRuns());
    } catch (err) {
      setError(
        err.response && err.response.status === 404
          ? "The agent runner is not enabled. Set AGENT_RUNNER_ENABLED=true and restart the server."
          : "Failed to load runs."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll only while something is actually in flight. A finished list is static,
  // and polling it forever is wasted work.
  useEffect(() => {
    const anyLive = runs.some((run) => LIVE_STATUSES.includes(run.status));
    if (!anyLive) return undefined;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [runs, load]);

  return (
    <div className="min-h-screen px-6 py-10 lg:px-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Agent Runs</h1>
          <p className="mt-1 text-sm text-slate-500">
            Event-triggered agent that writes code, runs it in an isolated sandbox, and
            corrects itself from its own errors.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="rounded-full border border-slate-700 px-4 py-2 text-xs text-slate-300 transition hover:bg-slate-800/60"
        >
          ← Back to dashboard
        </button>
      </header>

      {error && (
        <div className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
          <button type="button" onClick={load} className="ml-3 underline">
            Retry
          </button>
        </div>
      )}

      <section className="mt-8">
        <TriggerRunButton onTriggered={(runId) => navigate(`/runs/${runId}`)} />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
          Recent runs
        </h2>

        {loading ? (
          <div className="mt-6 flex items-center gap-3 text-sm text-slate-400">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-sky-400" />
            Loading runs...
          </div>
        ) : runs.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
            No runs yet. Trigger one above, or fire the webhook with scripts/demo.sh.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {runs.map((run) => (
              <button
                type="button"
                key={run.id}
                onClick={() => navigate(`/runs/${run.id}`)}
                className="flex w-full flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-800 bg-slate-950/60 p-5 text-left transition hover:border-sky-400/60 hover:shadow-lg hover:shadow-sky-500/5"
              >
                <div className="flex items-center gap-4">
                  <StatusBadge status={run.status} validated={run.validated} />
                  <span className="font-mono text-xs text-slate-500">{run.id.slice(-8)}</span>
                  <span className="rounded-full border border-slate-700 px-2.5 py-0.5 text-[11px] text-slate-400">
                    {run.triggerSource}
                  </span>
                </div>
                <div className="flex items-center gap-5 text-xs text-slate-500">
                  <span>
                    {run.attemptCount} attempt{run.attemptCount === 1 ? "" : "s"}
                  </span>
                  <span>{run.artifactCount} artifacts</span>
                  <span>{run.geminiCallCount} calls</span>
                  {run.totalDurationMs > 0 && <span>{(run.totalDurationMs / 1000).toFixed(1)}s</span>}
                  <span>
                    {run.createdAt
                      ? formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })
                      : ""}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
