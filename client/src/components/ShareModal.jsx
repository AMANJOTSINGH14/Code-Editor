import React, { useState } from "react";

/**
 * Share modal with invite link and copy feedback.
 * @param {Object} props - Component props.
 * @param {string} props.link - Share link.
 * @param {Function} props.onClose - Close handler.
 * @returns {JSX.Element} Modal.
 */
export default function ShareModal({ link, onClose }) {
  const [copied, setCopied] = useState(false);

  /**
   * Copy link to clipboard.
   * @returns {Promise<void>} Resolves when copied.
   */
  const copyLink = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-6" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-200">Share this room</h3>
        <p className="mt-2 text-sm text-slate-400">Copy the link below to invite collaborators.</p>
        <div className="mt-4 flex gap-2">
          <input
            readOnly
            value={link}
            className="flex-1 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-100"
          />
          <button
            type="button"
            onClick={copyLink}
            className="rounded-xl bg-emerald-400/90 px-4 py-2 text-xs font-semibold text-slate-900 transition hover:bg-emerald-300"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-800 px-4 py-2 text-xs text-slate-200 transition hover:bg-slate-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
