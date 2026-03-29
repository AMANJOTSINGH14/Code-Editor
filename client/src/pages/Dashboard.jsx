import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import api from "../services/api.js";
import { useAuth } from "../context/AuthContext.jsx";

/**
 * Dashboard page — list, create, and join documents.
 * @returns {JSX.Element} Dashboard page.
 */
export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("javascript");
  const [joinId, setJoinId] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  /**
   * Fetch accessible documents.
   * @returns {Promise<void>} Resolves when complete.
   */
  const fetchDocuments = async () => {
    try {
      setError("");
      const response = await api.get("/api/documents");
      setDocuments(response.data.data.documents || []);
    } catch (err) {
      setError("Failed to load documents. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  /**
   * Create a new document.
   * @returns {Promise<void>} Resolves when complete.
   */
  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const response = await api.post("/api/documents", {
        title: title || "Untitled",
        language,
        isPublic: true
      });
      const doc = response.data.data.document;
      navigate(`/editor/${doc.id}`);
    } catch (err) {
      setError("Failed to create document.");
      setCreating(false);
    }
  };

  /**
   * Join an existing document room.
   * @returns {void}
   */
  const handleJoin = () => {
    if (joinId.trim()) {
      navigate(`/editor/${joinId.trim()}`);
    }
  };

  return (
    <div className="min-h-screen animate-fade-up px-8 py-10">
      <header className="flex flex-wrap items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold text-slate-100">Hello {user?.name || "there"}</h1>
          <p className="text-sm text-slate-400">Pick a room or start a new session.</p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="rounded-full border border-slate-700 px-4 py-2 text-xs text-slate-300 transition hover:bg-slate-800"
        >
          Log out
        </button>
      </header>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
          <button type="button" onClick={fetchDocuments} className="ml-3 underline">
            Retry
          </button>
        </div>
      )}

      <section className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
            Create a room
          </h2>
          <div className="mt-4 flex flex-col gap-3">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Document title"
              className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-400/60 focus:outline-none"
            />
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 focus:border-sky-400/60 focus:outline-none"
            >
              <option value="javascript">JavaScript</option>
              <option value="typescript">TypeScript</option>
              <option value="python">Python</option>
              <option value="java">Java</option>
              <option value="go">Go</option>
              <option value="rust">Rust</option>
              <option value="csharp">C#</option>
            </select>
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="rounded-2xl bg-sky-400/90 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? "Creating..." : "Create document"}
            </button>
          </div>
        </div>
        <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
            Join a room
          </h2>
          <div className="mt-4 flex gap-3">
            <input
              value={joinId}
              onChange={(event) => setJoinId(event.target.value)}
              placeholder="Paste document id or room link"
              onKeyDown={(event) => event.key === "Enter" && handleJoin()}
              className="flex-1 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-400/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleJoin}
              className="rounded-2xl bg-emerald-400/90 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-emerald-300"
            >
              Join
            </button>
          </div>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
          Recent documents
        </h2>
        {loading ? (
          <div className="mt-6 flex items-center gap-3 text-sm text-slate-400">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-sky-400" />
            Loading documents...
          </div>
        ) : documents.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
            No documents yet. Create your first room above!
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {documents.map((doc) => (
              <button
                type="button"
                key={doc.id}
                onClick={() => navigate(`/editor/${doc.id}`)}
                className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5 text-left transition hover:border-sky-400/60 hover:shadow-lg hover:shadow-sky-500/5"
              >
                <div className="text-lg font-semibold text-slate-100">{doc.title}</div>
                <div className="mt-1 flex items-center gap-3">
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    {doc.language}
                  </span>
                  {doc.updatedAt && (
                    <span className="text-xs text-slate-600">
                      {formatDistanceToNow(new Date(doc.updatedAt), { addSuffix: true })}
                    </span>
                  )}
                </div>
                {doc.isPublic && (
                  <span className="mt-2 inline-block rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] uppercase text-emerald-300">
                    Public
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
