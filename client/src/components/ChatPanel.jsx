import React, { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";

/**
 * In-room chat panel with auto-scroll and timestamps.
 * @param {Object} props - Component props.
 * @param {string} props.documentId - Document id.
 * @param {Object} props.socket - Socket.io instance.
 * @param {Object} props.user - Current user.
 * @returns {JSX.Element} Chat panel.
 */
export default function ChatPanel({ documentId, socket, user }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    setMessages([]);
  }, [documentId]);

  useEffect(() => {
    if (!socket) return;

    const handleMessage = (payload) => {
      if (payload.documentId !== documentId) return;
      setMessages((prev) => [...prev, payload]);
    };

    socket.on("chat:message", handleMessage);

    return () => {
      socket.off("chat:message", handleMessage);
    };
  }, [socket, documentId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  /**
   * Send a chat message.
   * @param {React.FormEvent} event - Form event.
   * @returns {void}
   */
  const handleSubmit = (event) => {
    event.preventDefault();
    if (!input.trim() || !socket) return;
    socket.emit("chat:message", {
      documentId,
      message: input.trim()
    });
    setInput("");
  };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Room Chat</h3>

      <div ref={scrollRef} className="mt-3 flex-1 space-y-2 overflow-auto">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-600">
            No messages yet. Start the conversation!
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = user && msg.user && msg.user.id === user.id;
            return (
              <div
                key={msg.id}
                className={`rounded-xl p-3 text-sm ${
                  isMe ? "bg-sky-500/10 border border-sky-500/20" : "bg-slate-900/70"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-medium ${isMe ? "text-sky-300" : "text-slate-400"}`}>
                    {isMe ? "You" : msg.user?.name || "Unknown"}
                  </span>
                  {msg.createdAt && (
                    <span className="text-[10px] text-slate-600">
                      {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-slate-200">{msg.message}</div>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Type a message..."
          className="flex-1 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-400/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!input.trim() || !socket}
          className="rounded-xl bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
