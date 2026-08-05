import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import CodeEditor from "../components/CodeEditor.jsx";
import PresenceBar from "../components/PresenceBar.jsx";
import ChatPanel from "../components/ChatPanel.jsx";
import ReviewPanel from "../components/ReviewPanel.jsx";
// AGENT_RUNNER_START
import RunCodePanel from "../features/agent-runner/components/RunCodePanel.jsx";
import VerifyFixPanel from "../features/agent-runner/components/VerifyFixPanel.jsx";
// AGENT_RUNNER_END
import VersionHistory from "../components/VersionHistory.jsx";
import LanguageSelector from "../components/LanguageSelector.jsx";
import ShareModal from "../components/ShareModal.jsx";
import { useDocument } from "../hooks/useDocument.js";
import { useSocket } from "../hooks/useSocket.js";
import api from "../services/api.js";
import { useAuth } from "../context/AuthContext.jsx";

/**
 * Main editor page with real-time collaboration.
 * @returns {JSX.Element} Editor page.
 */
export default function Editor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { document, loading: docLoading, error: docError, refresh } = useDocument(id);
  const { socket, connected } = useSocket();
  const { user } = useAuth();
  const [presenceUsers, setPresenceUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [contributors, setContributors] = useState([]);
  const [contributorsOpen, setContributorsOpen] = useState(false);
  const [contributorsLoading, setContributorsLoading] = useState(false);
  const [contributorsError, setContributorsError] = useState("");
  const [currentContent, setCurrentContent] = useState("");
  const [language, setLanguage] = useState("javascript");
  const [showShare, setShowShare] = useState(false);
  const [toast, setToast] = useState("");
  const [activePanel, setActivePanel] = useState("chat");
  const [visibilityUpdating, setVisibilityUpdating] = useState(false);

  useEffect(() => {
    if (document && document.language) {
      setLanguage(document.language);
    }
  }, [document]);

  const fetchContributors = useCallback(async () => {
    if (!id) return;
    setContributorsLoading(true);
    setContributorsError("");
    try {
      const response = await api.get(`/api/documents/${id}/contributors`);
      setContributors(response.data.data.contributors || []);
    } catch {
      setContributorsError("Unable to load contributors.");
    } finally {
      setContributorsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchContributors();
  }, [fetchContributors]);

  useEffect(() => {
    if (!socket || !id) return;

    socket.emit("room:join", { documentId: id });

    const handlePresence = (payload) => {
      if (payload.documentId !== id) return;
      const unique = new Map();
      (payload.users || []).forEach((presence) => {
        if (!presence?.id) return;
        if (!unique.has(presence.id)) {
          unique.set(presence.id, presence);
        }
      });
      setPresenceUsers(Array.from(unique.values()));
    };

    const handleVisibility = async (payload) => {
      if (payload.documentId !== id) return;
      if (payload.isPublic) {
        await refresh();
        return;
      }

      try {
        await api.get(`/api/documents/${id}`);
        await refresh();
      } catch (error) {
        socket.emit("room:leave", { documentId: id });
        setToast("Access revoked. You no longer have access to this room.");
        setTimeout(() => setToast(""), 5000);
        navigate("/dashboard");
      }
    };

    const handleRestored = (payload) => {
      setToast(`Document restored to "${payload.label}" by ${payload.user?.name || "someone"}`);
      setTimeout(() => setToast(""), 5000);
    };

    const handleError = (payload) => {
      setToast(`Error: ${payload.message || "Unknown error"}`);
      setTimeout(() => setToast(""), 5000);
    };

    const handleKicked = (payload) => {
      if (payload.documentId !== id) return;
      socket.emit("room:leave", { documentId: id });
      setToast("Access revoked. You no longer have access to this room.");
      setTimeout(() => setToast(""), 5000);
      navigate("/dashboard");
    };

    socket.on("presence:update", handlePresence);
    socket.on("doc:restored", handleRestored);
    socket.on("error", handleError);
    socket.on("room:visibility", handleVisibility);
    socket.on("room:kicked", handleKicked);

    return () => {
      socket.emit("room:leave", { documentId: id });
      socket.off("presence:update", handlePresence);
      socket.off("doc:restored", handleRestored);
      socket.off("error", handleError);
      socket.off("room:visibility", handleVisibility);
      socket.off("room:kicked", handleKicked);
    };
  }, [socket, id, refresh, navigate]);

  /**
   * Update language setting on server.
   * @param {string} nextLanguage - New language.
   * @returns {Promise<void>} Resolves when updated.
   */
  const handleLanguageChange = async (nextLanguage) => {
    setLanguage(nextLanguage);
    try {
      await api.patch(`/api/documents/${id}`, { language: nextLanguage });
    } catch {
      // Non-owner collaborators may get 403, that's fine — local change still works
    }
  };

  /**
   * Toggle document visibility (public/private).
   * @returns {Promise<void>} Resolves when updated.
   */
  const handleVisibilityToggle = async () => {
    if (!document || visibilityUpdating) return;

    const nextIsPublic = !document.isPublic;
    setVisibilityUpdating(true);
    try {
      await api.patch(`/api/documents/${id}`, { isPublic: nextIsPublic });
      await refresh();
      setToast(`Room is now ${nextIsPublic ? "public" : "private"}.`);
    } catch (error) {
      const status = error?.response?.status;
      setToast(status === 403 ? "Only the owner can change visibility." : "Failed to update visibility.");
    } finally {
      setVisibilityUpdating(false);
      setTimeout(() => setToast(""), 5000);
    }
  };

  const shareLink = useMemo(() => `${window.location.origin}/editor/${id}`, [id]);

  const typingLabel = useMemo(() => {
    const others = (typingUsers || []).filter((entry) => entry.id !== user?.id);
    if (others.length === 0) {
      return "";
    }
    const names = others.map((entry) => entry.name || "Someone");
    if (names.length === 1) {
      return `${names[0]} is typing...`;
    }
    if (names.length === 2) {
      return `${names[0]} and ${names[1]} are typing...`;
    }
    return `${names[0]} and ${names.length - 1} others are typing...`;
  }, [typingUsers, user?.id]);

  if (docLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-500 border-t-sky-400" />
          Loading document...
        </div>
      </div>
    );
  }

  if (docError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <div className="text-lg text-rose-400">Failed to load document</div>
        <p className="text-sm text-slate-500">The document may not exist or you may not have access.</p>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="rounded-full bg-slate-800 px-6 py-2 text-sm text-slate-200 transition hover:bg-slate-700"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden px-4 py-4 animate-fade-up">
      {/* Header */}
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 px-5 py-3">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-700"
          >
            ← Back
          </button>
          <div>
            <div className="text-lg font-semibold text-slate-100">{document?.title || "Untitled"}</div>
            <div className="text-[11px] text-slate-500">Room {id}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <LanguageSelector language={language} onChange={handleLanguageChange} />
          <PresenceBar users={presenceUsers} />
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                const nextOpen = !contributorsOpen;
                setContributorsOpen(nextOpen);
                if (nextOpen) {
                  fetchContributors();
                }
              }}
              className="rounded-full border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-800"
            >
              Contrib {contributors.length}
            </button>
            {contributorsOpen && (
              <div className="absolute right-0 top-9 z-40 w-72 rounded-2xl border border-slate-800 bg-slate-950/95 p-4 shadow-xl shadow-slate-950/40 backdrop-blur">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Contributors
                  </span>
                  <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] text-slate-300">
                    {contributors.length} total
                  </span>
                </div>
                {contributorsLoading ? (
                  <div className="mt-3 text-xs text-slate-400">Loading contributors...</div>
                ) : contributorsError ? (
                  <div className="mt-3 text-xs text-rose-300">{contributorsError}</div>
                ) : contributors.length === 0 ? (
                  <div className="mt-3 text-xs text-slate-500">No contributors yet.</div>
                ) : (
                  <div className="mt-3 max-h-40 space-y-2 overflow-auto pr-1">
                    {contributors.map((contributor) => (
                      <div
                        key={contributor.id}
                        className="flex items-center justify-between rounded-lg border border-slate-800/60 bg-slate-900/40 px-3 py-2"
                      >
                        <span className="truncate text-xs text-slate-200">{contributor.email}</span>
                        {contributor.name && (
                          <span className="ml-2 text-[10px] uppercase tracking-[0.15em] text-slate-500">
                            {contributor.name}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {typingLabel && (
            <div className="max-w-[220px] truncate text-[11px] text-slate-500">
              {typingLabel}
            </div>
          )}
          <button
            type="button"
            onClick={handleVisibilityToggle}
            disabled={!document || visibilityUpdating}
            className="rounded-full border border-slate-700 px-4 py-1.5 text-xs text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {document?.isPublic ? "Make Private" : "Make Public"}
          </button>
          <button
            type="button"
            onClick={() => setShowShare(true)}
            className="rounded-full border border-slate-700 px-4 py-1.5 text-xs text-slate-200 transition hover:bg-slate-800"
          >
            Share
          </button>
          <div
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              connected
                ? "bg-emerald-400/15 text-emerald-300"
                : "bg-rose-400/15 text-rose-300"
            }`}
          >
            {connected ? "● Live" : "○ Offline"}
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 gap-4 overflow-hidden">
        {/* Editor area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <CodeEditor
              documentId={id}
              socket={socket}
              user={user}
              language={language}
              onChange={setCurrentContent}
              onTypingUsersChange={setTypingUsers}
            />
          </div>
        </div>

        {/* Right sidebar */}
        <div className="flex w-[340px] flex-shrink-0 flex-col overflow-hidden">
          {/* Panel tabs */}
          <div className="mb-2 flex rounded-xl border border-slate-800 bg-slate-950/60 p-1">
            {[
              { key: "chat", label: "Chat" },
              { key: "review", label: "AI Review" },
              // AGENT_RUNNER_START
              { key: "run", label: "Run" },
              { key: "verify", label: "Verify" },
              // AGENT_RUNNER_END
              { key: "versions", label: "Versions" }
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActivePanel(tab.key)}
                className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  activePanel === tab.key
                    ? "bg-slate-800 text-slate-100"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Active panel */}
          <div className="flex-1 overflow-hidden">
            {activePanel === "chat" && <ChatPanel documentId={id} socket={socket} user={user} />}
            {activePanel === "review" && <ReviewPanel documentId={id} />}
            {/* AGENT_RUNNER_START */}
            {activePanel === "run" && <RunCodePanel code={currentContent} language={language} />}
            {activePanel === "verify" && (
              <VerifyFixPanel code={currentContent} language={language} />
            )}
            {/* AGENT_RUNNER_END */}
            {activePanel === "versions" && (
              <VersionHistory documentId={id} currentContent={currentContent} language={language} />
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showShare && <ShareModal link={shareLink} onClose={() => setShowShare(false)} />}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-sky-500/90 px-5 py-3 text-sm font-medium text-white shadow-lg shadow-sky-500/20">
          {toast}
        </div>
      )}
    </div>
  );
}
