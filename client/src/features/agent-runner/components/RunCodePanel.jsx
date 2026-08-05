import React, { useCallback, useEffect, useState } from "react";
import api from "../../../services/api.js";

/**
 * Run the editor's current code in the sandbox and show the real result.
 *
 * The distinction from AI Review is the whole point: the reviewer gives an
 * opinion about the code, this executes it. An opinion can be confidently wrong
 * with nothing to catch it; an exit code cannot.
 *
 * @param {Object} props - Component props.
 * @param {string} props.code - Current editor contents.
 * @param {string} props.language - Document language.
 * @returns {JSX.Element} Run panel.
 */
export default function RunCodePanel({ code, language }) {
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [languages, setLanguages] = useState(null);

  // Ask the server what it can actually run, rather than hardcoding a list the
  // sandbox image might not match.
  useEffect(() => {
    let active = true;
    api
      .get("/api/runs/runtimes")
      .then((r) => active && setLanguages(r.data.data.languages))
      .catch(() => active && setLanguages([]));
    return () => {
      active = false;
    };
  }, []);

  const supported = languages === null ? null : languages.includes(language);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const response = await api.post("/api/runs/execute", { code, language });
      setResult(response.data.data);
    } catch (err) {
      const status = err.response && err.response.status;
      setError(
        status === 404
          ? "The agent runner is not enabled — set AGENT_RUNNER_ENABLED=true."
          : (err.response && err.response.data && err.response.data.error &&
              err.response.data.error.message) ||
              "Failed to run the code."
      );
    } finally {
      setRunning(false);
    }
  }, [code, language, running]);

  // Exit 0 is the only success. Anything else — including a timeout, which has
  // no exit code at all — is a failure and must not read as one.
  const ok = result && result.exitCode === 0 && !result.timedOut;

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Run</h3>
        <button
          type="button"
          onClick={run}
          disabled={running || supported === false}
          className="rounded-full bg-emerald-400/90 px-4 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Running..." : "▶ Run code"}
        </button>
      </div>

      {supported === false && (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          This sandbox image runs {(languages || []).join(", ") || "nothing"} — it cannot execute{" "}
          <b>{language}</b>. Switch the document language to JavaScript, or add a toolchain to
          agent-sandbox:node20.
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}

      {result && (
        <div
          className={`mt-3 flex items-center gap-3 rounded-xl border px-3 py-2 text-xs ${
            ok
              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
              : "border-rose-400/30 bg-rose-500/10 text-rose-300"
          }`}
        >
          <span className="font-semibold">
            {result.timedOut ? "TIMED OUT" : ok ? "exit 0" : `exit ${result.exitCode}`}
          </span>
          <span className="opacity-70">{result.durationMs}ms in sandbox</span>
          {result.outputTruncated && <span className="opacity-70">output truncated</span>}
        </div>
      )}

      <div className="mt-3 flex-1 overflow-auto rounded-xl bg-slate-900/60 p-3 font-mono text-xs">
        {running ? (
          <div className="flex items-center gap-2 text-slate-400">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-emerald-400" />
            Starting an isolated container...
          </div>
        ) : result ? (
          <>
            {result.stdout && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">stdout</div>
                <pre className="mt-1 whitespace-pre-wrap text-slate-200">{result.stdout}</pre>
              </div>
            )}
            {result.stderr && (
              <div className={result.stdout ? "mt-3" : ""}>
                <div className="text-[10px] uppercase tracking-[0.2em] text-rose-400/70">stderr</div>
                <pre className="mt-1 whitespace-pre-wrap text-rose-200">{result.stderr}</pre>
              </div>
            )}
            {!result.stdout && !result.stderr && (
              <div className="text-slate-600">Program produced no output.</div>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[11px] text-slate-600">
            <div>Runs your code in a locked-down container.</div>
            <div className="opacity-70">
              no network · read-only disk · 512MB · 30s limit · destroyed after
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
