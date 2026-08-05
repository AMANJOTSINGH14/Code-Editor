import React from "react";

// Colour carries meaning here, so the mapping is centralised rather than
// repeated per view. budget_exceeded is amber, not red: the run was stopped
// deliberately by a quota guard, which is different from something breaking.
const STYLES = {
  queued: "border-slate-600/50 bg-slate-600/10 text-slate-300",
  planning: "border-sky-400/40 bg-sky-500/10 text-sky-300",
  executing: "border-sky-400/40 bg-sky-500/10 text-sky-300",
  retrying: "border-amber-400/40 bg-amber-500/10 text-amber-300",
  succeeded: "border-emerald-400/40 bg-emerald-500/10 text-emerald-300",
  failed: "border-rose-400/40 bg-rose-500/10 text-rose-300",
  timeout: "border-orange-400/40 bg-orange-500/10 text-orange-300",
  budget_exceeded: "border-amber-400/40 bg-amber-500/10 text-amber-300"
};

const LABELS = {
  budget_exceeded: "budget exceeded"
};

const LIVE = ["planning", "executing", "retrying", "queued"];

/**
 * Coloured status pill for a run, plus a separate correctness badge.
 *
 * `validated` is deliberately a SECOND badge rather than another status value.
 * "succeeded" only ever meant "exited 0", and live runs proved that is
 * compatible with badly wrong output — so whether the answer was actually
 * checked is a different question from whether the process finished, and the UI
 * must not let one imply the other.
 *
 *   validated true  → "output verified"  (emerald, checked against exact values)
 *   validated false → "output wrong"     (rose, checked and mismatched)
 *   validated null  → "unverified"       (slate, no validator on this task)
 *
 * @param {Object} props - Component props.
 * @param {string} props.status - Run status.
 * @param {boolean|null} [props.validated] - Correctness verdict.
 * @returns {JSX.Element} Badge group.
 */
export default function StatusBadge({ status, validated }) {
  const style = STYLES[status] || STYLES.queued;

  const validation =
    validated === true
      ? { label: "✓ output verified", cls: "border-emerald-400/40 bg-emerald-500/10 text-emerald-300" }
      : validated === false
        ? { label: "✗ output wrong", cls: "border-rose-400/40 bg-rose-500/10 text-rose-300" }
        : status === "succeeded"
          ? { label: "unverified", cls: "border-slate-600/50 bg-slate-600/10 text-slate-400" }
          : null;

  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${style}`}
      >
        {LIVE.includes(status) && (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
        )}
        {LABELS[status] || status}
      </span>
      {validation && (
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${validation.cls}`}
          title="Whether the produced artifact was checked against exact expected values"
        >
          {validation.label}
        </span>
      )}
    </span>
  );
}
