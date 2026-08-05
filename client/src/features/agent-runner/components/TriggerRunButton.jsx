import React, { useEffect, useState } from "react";
import { fetchTasks, triggerRun } from "../api.js";

/**
 * Task picker plus manual trigger.
 * @param {Object} props - Component props.
 * @param {Function} props.onTriggered - Called with the new run id.
 * @returns {JSX.Element} Trigger control.
 */
export default function TriggerRunButton({ onTriggered }) {
  const [tasks, setTasks] = useState([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchTasks()
      .then((list) => {
        if (!active) return;
        setTasks(list);
        if (list.length) setSelected(list[0].id);
      })
      .catch(() => {
        if (active) setError("Could not load tasks.");
      });
    return () => {
      active = false;
    };
  }, []);

  /**
   * Fire a manual run.
   * @returns {Promise<void>} Resolves when the run is queued.
   */
  const handleTrigger = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await triggerRun(selected);
      if (onTriggered) onTriggered(result.runId);
    } catch (err) {
      const status = err.response && err.response.status;
      // 429 here is the runner's own manual-trigger limiter, not a Gemini quota
      // problem — saying so avoids sending someone to check the wrong thing.
      setError(
        status === 429
          ? "Rate limited — wait a moment before triggering another run."
          : (err.response && err.response.data && err.response.data.error &&
              err.response.data.error.message) ||
              "Failed to trigger the run."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
        Trigger a run
      </h2>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <select
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          disabled={!tasks.length}
          className="flex-1 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 focus:border-sky-400/60 focus:outline-none disabled:opacity-60"
        >
          {tasks.length === 0 ? (
            <option>No tasks seeded — run scripts/seed-demo.js</option>
          ) : (
            tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.name}
                {task.enabled ? "" : " (disabled)"}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          onClick={handleTrigger}
          disabled={busy || !tasks.length}
          className="rounded-2xl bg-sky-400/90 px-6 py-3 text-sm font-semibold text-slate-900 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Queueing..." : "Trigger run"}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}
    </div>
  );
}
