import React, { useState } from "react";
import { DiffEditor } from "@monaco-editor/react";

/**
 * Outcome label and colour for one attempt.
 * @param {Object} attempt - Attempt record.
 * @returns {{label: string, tone: string}} Presentation.
 */
function outcomeOf(attempt) {
  if (attempt.running) return { label: "running", tone: "text-sky-300" };
  if (attempt.timedOut) return { label: "timed out", tone: "text-orange-300" };
  const failedChecks = (attempt.validationFailures || []).length;
  if (attempt.exitCode === 0) {
    // A clean exit with wrong output is its own outcome. Labelling it "exit 0"
    // would imply success, which is exactly the confusion the validator exists
    // to remove.
    return failedChecks
      ? { label: `exit 0 · output wrong (${failedChecks})`, tone: "text-amber-300" }
      : { label: "exit 0", tone: "text-emerald-300" };
  }
  if (attempt.exitCode === null || attempt.exitCode === undefined) {
    return { label: "no result", tone: "text-slate-400" };
  }
  return { label: `exit ${attempt.exitCode}`, tone: "text-rose-300" };
}

/**
 * One expandable attempt row.
 * @param {Object} props - Component props.
 * @param {Object} props.attempt - Attempt record.
 * @param {Object|null} props.previous - Preceding attempt, for the diff.
 * @param {boolean} props.defaultOpen - Whether to start expanded.
 * @returns {JSX.Element} Attempt row.
 */
function AttemptRow({ attempt, previous, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState("output");
  const outcome = outcomeOf(attempt);

  // A diff is only meaningful from attempt 2 onward, and only once both sides
  // have code — during a live run the code arrives before the result does.
  const canDiff = Boolean(previous && previous.generatedCode && attempt.generatedCode);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/40">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition hover:bg-slate-900/40"
      >
        <div className="flex items-center gap-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-700 text-xs font-semibold text-slate-300">
            {attempt.index}
          </span>
          <span className={`text-sm font-medium ${outcome.tone}`}>{outcome.label}</span>
          {typeof attempt.durationMs === "number" && attempt.durationMs > 0 && (
            <span className="text-xs text-slate-600">{attempt.durationMs}ms</span>
          )}
        </div>
        <span className="text-xs text-slate-500">{open ? "collapse" : "expand"}</span>
      </button>

      {open && (
        <div className="border-t border-slate-800 px-5 py-4">
          {attempt.plan && (
            <div className="mb-4">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Plan</div>
              <p className="mt-1 text-sm text-slate-300">{attempt.plan}</p>
            </div>
          )}

          {(attempt.validationFailures || []).length > 0 && (
            <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-amber-400/80">
                Output checks failed — the program ran, the answer was wrong
              </div>
              <div className="mt-2 space-y-1 font-mono text-xs text-amber-200">
                {attempt.validationFailures.map((f, i) => (
                  <div key={i}>
                    {f.label}: expected <b>{JSON.stringify(f.expected)}</b>, got{" "}
                    <b>{JSON.stringify(f.actual)}</b>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            {["output", "code", ...(canDiff ? ["diff"] : [])].map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setTab(name)}
                className={`rounded-full px-3 py-1 text-xs transition ${
                  tab === name
                    ? "bg-sky-400/90 font-semibold text-slate-900"
                    : "border border-slate-700 text-slate-400 hover:bg-slate-800/60"
                }`}
              >
                {name === "diff" ? `diff vs attempt ${previous.index}` : name}
              </button>
            ))}
          </div>

          {tab === "output" && (
            <div className="mt-3 space-y-3">
              {attempt.stderr ? (
                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-rose-400/70">stderr</div>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-900/60 p-3 font-mono text-xs text-rose-200">
                    {attempt.stderr}
                  </pre>
                </div>
              ) : null}
              {attempt.stdout ? (
                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">stdout</div>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-900/60 p-3 font-mono text-xs text-slate-300">
                    {attempt.stdout}
                  </pre>
                </div>
              ) : null}
              {!attempt.stderr && !attempt.stdout && (
                <div className="text-xs text-slate-600">No output captured.</div>
              )}
            </div>
          )}

          {tab === "code" && (
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-900/60 p-3 font-mono text-xs text-slate-200">
              {attempt.generatedCode || "(code not available)"}
            </pre>
          )}

          {tab === "diff" && canDiff && (
            <div className="mt-3 h-96 overflow-hidden rounded-xl border border-slate-800">
              {/* Monaco's DiffEditor is already used by the version history
                  viewer, so the diff matches the rest of the app and costs no
                  new dependency. */}
              <DiffEditor
                height="100%"
                original={previous.generatedCode}
                modified={attempt.generatedCode}
                language="javascript"
                theme="vs-dark"
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  renderSideBySide: true,
                  scrollBeyondLastLine: false,
                  fontSize: 12
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Attempt-by-attempt history with code diffs between consecutive attempts.
 * @param {Object} props - Component props.
 * @param {Array} props.attempts - Attempt records, in order.
 * @returns {JSX.Element} Accordion.
 */
export default function AttemptAccordion({ attempts }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
        Attempts
      </h2>

      {attempts.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
          No attempts yet.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {attempts.map((attempt, i) => (
            <AttemptRow
              key={attempt.index}
              attempt={attempt}
              previous={i > 0 ? attempts[i - 1] : null}
              // The last attempt is the interesting one, so it opens by default.
              defaultOpen={i === attempts.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
