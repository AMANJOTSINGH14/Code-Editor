import React from "react";
import { artifactUrl } from "../api.js";
import { getAccessToken } from "../../../services/api.js";

/**
 * Format a byte count for display.
 * @param {number} bytes - Size in bytes.
 * @returns {string} Human-readable size.
 */
function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Artifacts produced by a run, with download links.
 * @param {Object} props - Component props.
 * @param {string} props.runId - Run id.
 * @param {Array} props.artifacts - Artifact metadata.
 * @returns {JSX.Element} Artifact list.
 */
export default function ArtifactList({ runId, artifacts }) {
  /**
   * Download an artifact.
   *
   * A plain <a href> cannot carry the Authorization header the download route
   * requires, so the file is fetched with the token and handed to the browser
   * as an object URL.
   * @param {string} name - Artifact filename.
   * @returns {Promise<void>} Resolves when the download starts.
   */
  const download = async (name) => {
    const token = getAccessToken();
    const response = await fetch(artifactUrl(runId, name), {
      headers: { Authorization: token ? `Bearer ${token}` : "" },
      credentials: "include"
    });
    if (!response.ok) return;

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
        Artifacts
      </h2>

      {artifacts.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
          No artifacts produced.
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {artifacts.map((artifact) => (
            <div
              key={artifact.name}
              className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/40 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate font-mono text-sm text-slate-200">{artifact.name}</div>
                <div className="mt-0.5 flex gap-3 text-[11px] text-slate-500">
                  <span>{formatSize(artifact.sizeBytes)}</span>
                  {artifact.sha256 && <span>sha256 {artifact.sha256.slice(0, 12)}…</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => download(artifact.name)}
                className="shrink-0 rounded-full border border-sky-400/40 px-4 py-1.5 text-xs text-sky-300 transition hover:bg-sky-400/10"
              >
                Download
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
