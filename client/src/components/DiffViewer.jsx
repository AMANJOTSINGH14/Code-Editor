import React from "react";
import { DiffEditor } from "@monaco-editor/react";

/**
 * Monaco diff viewer overlay for version comparison.
 * @param {Object} props - Component props.
 * @param {string} props.original - Original (version) text.
 * @param {string} props.modified - Modified (current) text.
 * @param {string} props.language - Language id.
 * @param {Function} props.onClose - Close handler.
 * @returns {JSX.Element} Diff viewer.
 */
export default function DiffViewer({ original, modified, language, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6">
      <div className="flex h-[80vh] w-full max-w-6xl flex-col rounded-2xl border border-slate-800 bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold text-slate-200">Version Diff</span>
            <div className="flex gap-4 text-xs text-slate-500">
              <span>← Saved Version</span>
              <span>Current Content →</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-800 px-4 py-1.5 text-xs text-slate-200 transition hover:bg-slate-700"
          >
            Close
          </button>
        </div>
        <div className="flex-1">
          <DiffEditor
            height="100%"
            original={original || ""}
            modified={modified || ""}
            language={language}
            theme="vs-dark"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              renderSideBySide: true,
              scrollBeyondLastLine: false
            }}
          />
        </div>
      </div>
    </div>
  );
}
