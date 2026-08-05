import React, { useEffect, useRef } from "react";

/**
 * Streaming log panel.
 * @param {Object} props - Component props.
 * @param {Array} props.logs - Log entries.
 * @param {boolean} props.connected - Whether the stream is open.
 * @param {boolean} props.done - Whether the run finished.
 * @returns {JSX.Element} Log panel.
 */
export default function LiveLog({ logs, connected, done }) {
  const endRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    // Follow the tail only when the user is already at the bottom — yanking the
    // view down while they are reading earlier output is worse than not
    // following at all.
    const container = containerRef.current;
    if (!container) return;
    const nearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    if (nearBottom && endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
          Live log
        </h2>
        {!done && connected && (
          <span className="flex items-center gap-2 text-xs text-slate-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            streaming
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        className="mt-4 max-h-72 overflow-auto rounded-2xl bg-slate-900/60 p-4 font-mono text-xs leading-relaxed"
      >
        {logs.length === 0 ? (
          <div className="text-slate-600">Waiting for the run to start...</div>
        ) : (
          logs.map((entry, index) => (
            <div
              key={index}
              className={
                entry.level === "warn"
                  ? "text-amber-300"
                  : entry.level === "error"
                    ? "text-rose-300"
                    : "text-slate-300"
              }
            >
              {entry.message}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
