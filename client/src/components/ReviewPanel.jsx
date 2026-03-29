import React from "react";
import { useReview } from "../hooks/useReview.js";

/**
 * AI code review panel with streaming output.
 * @param {Object} props - Component props.
 * @param {string} props.documentId - Document id.
 * @returns {JSX.Element} Review panel.
 */
export default function ReviewPanel({ documentId }) {
  const { reviewText, loading, notice, error, startReview, stopReview } = useReview();

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">AI Review</h3>
        <div className="flex gap-2">
          {loading && (
            <button
              type="button"
              onClick={stopReview}
              className="rounded-full border border-rose-400/40 px-3 py-1.5 text-xs text-rose-300 transition hover:bg-rose-400/10"
            >
              Stop
            </button>
          )}
          <button
            type="button"
            onClick={() => startReview(documentId)}
            disabled={loading}
            className="rounded-full bg-sky-400/90 px-4 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Reviewing..." : "Review My Code"}
          </button>
        </div>
      </div>

      {notice && (
        <div className="mt-3 rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
          {notice}
        </div>
      )}

      <div className="mt-3 flex-1 overflow-auto rounded-xl bg-slate-900/60 p-3">
        {error ? (
          <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>
        ) : loading && !reviewText ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-sky-400" />
            Streaming review...
          </div>
        ) : reviewText ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{reviewText}</div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-600">
            Click "Review My Code" to get AI feedback on your code.
          </div>
        )}
      </div>
    </div>
  );
}
