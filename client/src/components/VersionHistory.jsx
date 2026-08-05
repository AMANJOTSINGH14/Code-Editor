import React, { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import api from "../services/api.js";
import DiffViewer from "./DiffViewer.jsx";

/**
 * Version history sidebar with save, preview, and restore.
 * @param {Object} props - Component props.
 * @param {string} props.documentId - Document id.
 * @param {string} props.currentContent - Current editor content.
 * @param {string} props.language - Current language.
 * @returns {JSX.Element} Version history panel.
 */
export default function VersionHistory({ documentId, currentContent, language }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [label, setLabel] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  /**
   * Fetch version history from API.
   * @returns {Promise<void>} Resolves when complete.
   */
  const fetchVersions = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get(`/api/documents/${documentId}/versions?page=1&limit=50`);
      // Defensive newest-first sort so the latest save is always at the top,
      // regardless of the order the API returns.
      const items = [...(response.data.data.items || [])].sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt) || b.versionNumber - a.versionNumber
      );
      setVersions(items);
    } catch {
      setError("Failed to load versions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (documentId) {
      fetchVersions();
    }
  }, [documentId]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((v) => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  /**
   * Save a published version.
   * @returns {Promise<void>} Resolves when saved.
   */
  const handleSave = async () => {
    if (cooldown > 0 || saving) return;
    setSaving(true);
    try {
      await api.post(`/api/documents/${documentId}/versions`, { label: label || undefined });
      setLabel("");
      setCooldown(10);
      await fetchVersions();
    } catch (err) {
      const msg = err?.response?.data?.error?.message || "Failed to save version";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Restore a selected version.
   * @param {Object} version - Version to restore.
   * @returns {Promise<void>} Resolves when restored.
   */
  const handleRestore = async (version) => {
    const confirmed = window.confirm(
      "This will replace the current content for all collaborators. Continue?"
    );
    if (!confirmed) return;
    try {
      await api.post(`/api/documents/${documentId}/versions/${version.id}/restore`);
      await fetchVersions();
    } catch {
      setError("Failed to restore version");
    }
  };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
        Version History
      </h3>

      {/* Save version form */}
      <div className="mt-3 flex gap-2">
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Version label (optional)"
          onKeyDown={(event) => event.key === "Enter" && handleSave()}
          className="flex-1 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-amber-400/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={cooldown > 0 || saving}
          className="rounded-xl bg-amber-300/90 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "..." : cooldown > 0 ? `${cooldown}s` : "Save"}
        </button>
      </div>

      {error && (
        <div className="mt-2 rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
          {error}
        </div>
      )}

      {/* Version list */}
      <div className="mt-3 flex-1 space-y-2 overflow-auto">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-amber-400" />
            Loading versions...
          </div>
        ) : versions.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-600">
            No versions yet. Save your first version above.
          </div>
        ) : (
          versions.map((version) => (
            <div
              key={version.id}
              className="rounded-xl border border-slate-800 bg-slate-900/60 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-200">{version.label}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {formatDistanceToNow(new Date(version.createdAt), { addSuffix: true })}
                    {version.createdByName ? ` · ${version.createdByName}` : ""}
                  </div>
                </div>
                {version.isPublished ? (
                  <span className="flex-shrink-0 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] uppercase text-emerald-200">
                    Published
                  </span>
                ) : (
                  <span className="flex-shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] uppercase text-slate-400">
                    Auto
                  </span>
                )}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPreview(version)}
                  className="rounded-lg bg-slate-800 px-2 py-1 text-[11px] text-slate-200 transition hover:bg-slate-700"
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => handleRestore(version)}
                  className="rounded-lg bg-sky-500/20 px-2 py-1 text-[11px] text-sky-200 transition hover:bg-sky-500/30"
                >
                  Restore
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Diff viewer overlay */}
      {preview && (
        <DiffViewer
          original={preview.snapshotText || ""}
          modified={currentContent || ""}
          language={language}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
