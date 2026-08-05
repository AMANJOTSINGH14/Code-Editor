import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchRun } from "./api.js";
import { useRunStream } from "./hooks/useRunStream.js";
import StatusBadge from "./components/StatusBadge.jsx";
import LiveLog from "./components/LiveLog.jsx";
import AttemptAccordion from "./components/AttemptAccordion.jsx";
import ArtifactList from "./components/ArtifactList.jsx";

/**
 * Merge persisted attempts with live stream updates.
 *
 * The stream carries execution results but not generated code (which would be
 * far too large to push per event), while the persisted record has the code but
 * lags behind live progress. Neither source alone can render the view, so they
 * are merged by attempt index.
 * @param {Array} persisted - Attempts from the run document.
 * @param {Array} live - Attempts from the SSE stream.
 * @returns {Array} Merged attempts, ordered.
 */
function mergeAttempts(persisted, live) {
  const byIndex = new Map();
  persisted.forEach((attempt) => byIndex.set(attempt.index, { ...attempt }));
  live.forEach((attempt) => {
    byIndex.set(attempt.index, { ...(byIndex.get(attempt.index) || {}), ...attempt });
  });
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/**
 * Run detail page with live streaming.
 * @returns {JSX.Element} Run detail page.
 */
export default function RunDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const stream = useRunStream(id);

  const load = useCallback(async () => {
    try {
      setRun(await fetchRun(id));
    } catch {
      setError("Failed to load this run.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Refetch once the stream reports completion, to pick up the generated code
  // and final artifact records the stream does not carry.
  useEffect(() => {
    if (stream.done) load();
  }, [stream.done, load]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-500 border-t-sky-400" />
          Loading run...
        </div>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="min-h-screen px-6 py-10 lg:px-12">
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error || "Run not found."}
        </div>
        <button
          type="button"
          onClick={() => navigate("/runs")}
          className="mt-4 rounded-full border border-slate-700 px-4 py-2 text-xs text-slate-300 transition hover:bg-slate-800/60"
        >
          ← Back to runs
        </button>
      </div>
    );
  }

  const status = stream.status || run.status;
  const attempts = mergeAttempts(run.attempts || [], stream.attempts);
  const artifacts = run.artifacts && run.artifacts.length ? run.artifacts : stream.artifacts;
  const failure = run.error && run.error.message ? run.error : null;

  return (
    <div className="min-h-screen px-6 py-10 lg:px-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-100">Run</h1>
            <span className="font-mono text-sm text-slate-500">{run.id.slice(-8)}</span>
            <StatusBadge status={status} validated={run.validated} />
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
            <span>trigger: {run.triggerSource}</span>
            <span>{attempts.length} attempts</span>
            <span>{run.geminiCallCount ?? (run.geminiCalls || []).length} Gemini calls</span>
            {run.totalDurationMs > 0 && <span>{(run.totalDurationMs / 1000).toFixed(1)}s total</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate("/runs")}
          className="rounded-full border border-slate-700 px-4 py-2 text-xs text-slate-300 transition hover:bg-slate-800/60"
        >
          ← Back to runs
        </button>
      </header>

      {failure && (
        <div
          className={`mt-6 rounded-xl border px-4 py-3 text-sm ${
            // A quota stop is a deliberate guard doing its job, not a breakage —
            // colouring it like a crash would misrepresent what happened.
            failure.code === "BUDGET_EXCEEDED" || failure.code === "DAILY_CAP_EXCEEDED"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
              : failure.code === "DEMO_CACHE_REPLAY"
                ? "border-sky-500/30 bg-sky-500/10 text-sky-200"
                : "border-rose-500/30 bg-rose-500/10 text-rose-300"
          }`}
        >
          <span className="font-mono text-xs opacity-70">{failure.code}</span>
          <div className="mt-1">{failure.message}</div>
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
        <div className="space-y-6">
          <AttemptAccordion attempts={attempts} />
        </div>
        <div className="space-y-6">
          <LiveLog logs={stream.logs} connected={stream.connected} done={stream.done} />
          <ArtifactList runId={run.id} artifacts={artifacts} />

          {(run.geminiCalls || []).length > 0 && (
            <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-6">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
                Gemini calls
              </h2>
              <div className="mt-4 space-y-2">
                {run.geminiCalls.map((call, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between rounded-xl bg-slate-900/40 px-3 py-2 text-[11px] text-slate-400"
                  >
                    <span className="font-mono">{call.model}</span>
                    <span>{call.totalTokens} tok</span>
                    <span>{call.latencyMs}ms</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
