import React, { useCallback, useRef, useState } from "react";
import { getAccessToken } from "../../../services/api.js";

const PHASES = {
  analysing: "Looking for a provable bug...",
  refixing: "Previous fix failed its own test — trying again...",
  proving: "Running the test against YOUR code to prove the bug is real...",
  verifying_fix: "Running the same test against the fix...",
  fixed: "Fixed and verified",
  clean: "No provable bug found",
  unfixed: "Bug proven, fix failed"
};

/**
 * Verify & Fix — the closed loop.
 *
 * AI Review tells you what it thinks is wrong. This proves it: the model must
 * write a test that FAILS on your code, then a fix that makes the same test
 * pass. If its test passes on your original code, the claim was imaginary and
 * gets thrown away rather than shown to you.
 *
 * @param {Object} props - Component props.
 * @param {string} props.code - Current editor contents.
 * @param {string} props.language - Document language.
 * @returns {JSX.Element} Verify panel.
 */
export default function VerifyFixPanel({ code, language }) {
  const [phase, setPhase] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const controllerRef = useRef(null);

  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    setPhase("analysing");
    setCopied(false);

    const controller = new AbortController();
    controllerRef.current = controller;
    const base = import.meta.env.VITE_API_URL || "http://localhost:3001";

    try {
      // fetch + reader rather than EventSource, for the same reason as the rest
      // of the app: EventSource cannot send an Authorization header.
      const response = await fetch(`${base}/api/runs/verify-fix`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAccessToken() || ""}`
        },
        credentials: "include",
        body: JSON.stringify({ code, language }),
        signal: controller.signal
      });

      if (!response.ok) {
        setError(response.status === 404 ? "Agent runner is not enabled." : "Verification failed to start.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";

        blocks.forEach((block) => {
          if (!block.includes("data:")) return;
          let event = "message";
          let data = "";
          block.split("\n").forEach((line) => {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            if (line.startsWith("data:")) data += line.slice(5).trim();
          });
          if (!data) return;
          try {
            const payload = JSON.parse(data);
            if (event === "status") setPhase(payload.phase);
            else if (event === "result") setResult(payload);
            else if (event === "error") setError(payload.message);
          } catch {
            // partial frame; the next read completes it
          }
        });
      }
    } catch (err) {
      if (err.name !== "AbortError") setError("Lost connection during verification.");
    } finally {
      setBusy(false);
    }
  }, [code, language, busy]);

  const copyFix = () => {
    if (!result || !result.fixedCode) return;
    navigator.clipboard.writeText(result.fixedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const unsupported = language !== "javascript";

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
          Verify &amp; Fix
        </h3>
        <button
          type="button"
          onClick={start}
          disabled={busy || unsupported}
          className="rounded-full bg-violet-400/90 px-4 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-violet-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Working..." : "Prove & fix a bug"}
        </button>
      </div>

      {unsupported && (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Only JavaScript can be executed here, so a {language} bug cannot be proven by running it.
        </div>
      )}

      {busy && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-violet-400" />
          {PHASES[phase] || "Working..."}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}

      <div className="mt-3 flex-1 overflow-auto">
        {!result && !busy && !error && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-[11px] text-slate-600">
            <div>The reviewer gives opinions. This one has to prove it.</div>
            <div className="opacity-70">
              writes a test that FAILS on your code → fixes it → same test must PASS
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-3 text-xs">
            {/* Outcome */}
            <div
              className={`rounded-xl border px-3 py-2 ${
                result.outcome === "fixed"
                  ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                  : result.outcome === "no_bug_proven"
                    ? "border-sky-400/30 bg-sky-500/10 text-sky-200"
                    : "border-amber-400/30 bg-amber-500/10 text-amber-200"
              }`}
            >
              <div className="font-semibold">
                {result.outcome === "fixed"
                  ? "✓ Bug proven and fixed"
                  : result.outcome === "no_bug_proven"
                    ? "No provable bug"
                    : "Bug proven — fix failed"}
              </div>
              {result.message && <div className="mt-1 opacity-80">{result.message}</div>}
              <div className="mt-1 opacity-60">
                {result.geminiCalls} Gemini call{result.geminiCalls === 1 ? "" : "s"} ·{" "}
                {(result.totalMs / 1000).toFixed(1)}s
              </div>
            </div>

            {/* The claim */}
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">The bug</div>
              <p className="mt-1 text-slate-300">{result.bug}</p>
            </div>

            {/* The proof — this is the part a normal reviewer cannot give you */}
            {result.proof && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                  Proof — test run against YOUR code
                </div>
                <div
                  className={`mt-1 font-mono ${
                    result.proof.exitCode === 0 ? "text-sky-300" : "text-rose-300"
                  }`}
                >
                  exit {result.proof.timedOut ? "timeout" : result.proof.exitCode}
                  {result.proof.exitCode !== 0 ? "  ← the bug is real" : "  ← claim not demonstrated"}
                </div>
                {result.proof.stderr && (
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900/60 p-2 font-mono text-[11px] text-rose-200">
                    {result.proof.stderr.slice(0, 800)}
                  </pre>
                )}
              </div>
            )}

            {/* The test itself */}
            <details>
              <summary className="cursor-pointer text-[10px] uppercase tracking-[0.2em] text-slate-500">
                The test it wrote
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900/60 p-2 font-mono text-[11px] text-slate-300">
                {result.testCode}
              </pre>
            </details>

            {/* Cycles */}
            {(result.cycles || []).length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                  Fix attempts
                </div>
                {result.cycles.map((c) => (
                  <div
                    key={c.cycle}
                    className={`mt-1 font-mono ${c.passed ? "text-emerald-300" : "text-rose-300"}`}
                  >
                    cycle {c.cycle}: exit {c.timedOut ? "timeout" : c.exitCode}{" "}
                    {c.passed ? "— test passes" : "— still failing"}
                  </div>
                ))}
              </div>
            )}

            {/* The fix */}
            {result.fixedCode && (
              <div>
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                    Fixed code
                  </div>
                  <button
                    type="button"
                    onClick={copyFix}
                    className="rounded-full border border-slate-700 px-3 py-1 text-[10px] text-slate-300 transition hover:bg-slate-800"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900/60 p-2 font-mono text-[11px] text-emerald-100">
                  {result.fixedCode}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
