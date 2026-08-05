import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { MonacoBinding } from "y-monaco";
import { getUserColor } from "../utils/colors.js";

/**
 * Encode a Uint8Array to base64.
 * @param {Uint8Array} update - Binary data.
 * @returns {string} Base64 string.
 */
function encodeUpdate(update) {
  let binary = "";
  update.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

/**
 * Decode a base64 string to Uint8Array.
 * @param {string} data - Base64 string.
 * @returns {Uint8Array} Binary data.
 */
function decodeUpdate(data) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Collaborative Monaco editor with Yjs CRDT binding.
 * @param {Object} props - Component props.
 * @param {string} props.documentId - Document id.
 * @param {Object} props.socket - Socket.io instance.
 * @param {Object} props.user - Current user.
 * @param {string} props.language - Language id.
 * @param {Function} props.onChange - Content change callback.
 * @param {Function} [props.onTypingUsersChange] - Typing users change callback.
 * @returns {JSX.Element} Editor component.
 */
export default function CodeEditor({ documentId, socket, user, language, onChange, onTypingUsersChange }) {
  const editorRef = useRef(null);
  const bindingRef = useRef(null);
  const docRef = useRef(null);
  const awarenessRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const contentNotifyTimerRef = useRef(null);
  const isTypingRef = useRef(false);
  const cursorLineRef = useRef(1);
  const cursorListenerRef = useRef(null);
  const typingDecorationsRef = useRef([]);
  const remoteStyleRef = useRef(null);
  const activeLabelsRef = useRef(new Set());
  const labelTimersRef = useRef(new Map());
  const [ready, setReady] = useState(false);

  const editorOptions = useMemo(
    () => ({
      minimap: { enabled: true },
      bracketPairColorization: { enabled: true },
      autoClosingBrackets: "always",
      fontFamily: "JetBrains Mono, monospace",
      fontSize: 14,
      smoothScrolling: true,
      padding: { top: 12 }
    }),
    []
  );

  useEffect(() => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    docRef.current = doc;
    awarenessRef.current = awareness;
    setReady(false);

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      if (contentNotifyTimerRef.current) {
        clearTimeout(contentNotifyTimerRef.current);
        contentNotifyTimerRef.current = null;
      }
      isTypingRef.current = false;
      cursorLineRef.current = 1;
      if (cursorListenerRef.current) {
        cursorListenerRef.current.dispose();
        cursorListenerRef.current = null;
      }
      if (editorRef.current) {
        typingDecorationsRef.current = editorRef.current.deltaDecorations(typingDecorationsRef.current, []);
      }
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
      if (remoteStyleRef.current) {
        remoteStyleRef.current.remove();
        remoteStyleRef.current = null;
      }
      labelTimersRef.current.forEach((timerId) => clearTimeout(timerId));
      labelTimersRef.current.clear();
      activeLabelsRef.current.clear();
      awareness.destroy();
      doc.destroy();
      docRef.current = null;
      awarenessRef.current = null;
      setReady(false);
    };
  }, [documentId]);

  useEffect(() => {
    if (!awarenessRef.current || !user) {
      return;
    }

    awarenessRef.current.setLocalStateField("user", {
      id: user.id,
      name: user.name,
      color: getUserColor(user.id)
    });
    awarenessRef.current.setLocalStateField("typing", false);
    awarenessRef.current.setLocalStateField("cursorLine", cursorLineRef.current);
  }, [user, documentId]);

  /**
   * Notify the parent of content changes, debounced. Serializing the whole
   * Yjs text and re-rendering the page on EVERY keystroke makes typing lag
   * (keys feel stuck / characters appear late), so we coalesce to one
   * notification shortly after typing pauses. The content is only consumed by
   * the version-diff preview, which doesn't need per-keystroke freshness.
   * @returns {void}
   */
  const scheduleContentNotify = useCallback(() => {
    if (!onChange) {
      return;
    }
    if (contentNotifyTimerRef.current) {
      clearTimeout(contentNotifyTimerRef.current);
    }
    contentNotifyTimerRef.current = setTimeout(() => {
      contentNotifyTimerRef.current = null;
      if (docRef.current) {
        onChange(docRef.current.getText("content").toString());
      }
    }, 300);
  }, [onChange]);

  const updateTypingDecorations = useCallback(() => {
    const editor = editorRef.current;
    const awareness = awarenessRef.current;
    if (!editor || !awareness) {
      return;
    }

    const model = editor.getModel();
    if (!model) {
      return;
    }

    const states = Array.from(awareness.getStates().values());
    const seen = new Set();
    const decorations = [];

    states.forEach((state) => {
      const userState = state?.user;
      if (!state?.typing || !userState || userState.id === user?.id) {
        return;
      }

      const lineNumber = Number(state.cursorLine);
      if (!Number.isFinite(lineNumber) || lineNumber < 1) {
        return;
      }

      if (seen.has(userState.id)) {
        return;
      }
      seen.add(userState.id);

      const name = userState.name || "Someone";

      // Anchor the label at the END of the line. Injecting it at column 1
      // pushes the line's real text to the right, which makes typed characters
      // appear to shift/land in the wrong place while someone else is typing.
      const line = Math.min(lineNumber, model.getLineCount());
      const endColumn = model.getLineMaxColumn(line);

      decorations.push({
        range: {
          startLineNumber: line,
          startColumn: endColumn,
          endLineNumber: line,
          endColumn: endColumn
        },
        options: {
          isWholeLine: false,
          after: {
            contentText: `  ${name} typing`,
            inlineClassName: "typing-line-label",
            inlineClassNameAffectsLetterSpacing: true
          }
        }
      });
    });

    typingDecorationsRef.current = editor.deltaDecorations(typingDecorationsRef.current, decorations);
  }, [user?.id]);

  const emitTypingUsers = useCallback(() => {
    if (!awarenessRef.current) {
      return;
    }

    if (onTypingUsersChange) {
      const states = Array.from(awarenessRef.current.getStates().values());
      const unique = new Map();

      states.forEach((state) => {
        const userState = state?.user;
        if (!state?.typing || !userState) {
          return;
        }
        if (userState.id === user?.id) {
          return;
        }
        if (!unique.has(userState.id)) {
          unique.set(userState.id, {
            id: userState.id,
            name: userState.name || "Someone",
            color: userState.color
          });
        }
      });

      onTypingUsersChange(Array.from(unique.values()));
    }

    updateTypingDecorations();
  }, [onTypingUsersChange, updateTypingDecorations, user?.id]);

  /**
   * Inject per-user color + name styles for the remote carets that y-monaco
   * renders (classes yRemoteSelection-<clientId> / yRemoteSelectionHead-<clientId>).
   * y-monaco draws the caret/selection decorations but provides no styling.
   * @returns {void}
   */
  const renderRemoteCursorStyles = useCallback(() => {
    const awareness = awarenessRef.current;
    const doc = docRef.current;
    if (!awareness || !doc) {
      return;
    }

    if (!remoteStyleRef.current) {
      const styleEl = document.createElement("style");
      styleEl.setAttribute("data-yjs-cursors", "");
      document.head.appendChild(styleEl);
      remoteStyleRef.current = styleEl;
    }

    const active = activeLabelsRef.current;
    const rules = [];
    awareness.getStates().forEach((state, clientId) => {
      if (clientId === doc.clientID) {
        return;
      }
      const remoteUser = state?.user;
      if (!remoteUser) {
        return;
      }
      const color = remoteUser.color || "#38bdf8";
      const name = String(remoteUser.name || "Someone").replace(/["\\<>]/g, "");
      // Caret + selection are always visible; the name tag only shows while the
      // remote user is active and fades out shortly after (Google Docs style).
      const labelOpacity = active.has(clientId) ? 1 : 0;
      rules.push(`.yRemoteSelection-${clientId}{background-color:${color}33;}`);
      rules.push(`.yRemoteSelectionHead-${clientId}{border-left-color:${color};}`);
      rules.push(
        `.yRemoteSelectionHead-${clientId}::after{content:"${name}";background-color:${color};opacity:${labelOpacity};}`
      );
    });

    remoteStyleRef.current.textContent = rules.join("\n");
  }, []);

  /**
   * Mark a remote user as active so their name tag shows, then schedule it to
   * fade back to just the caret after a short delay.
   * @param {number} clientId - Remote Yjs client id.
   * @returns {void}
   */
  const markRemoteActive = useCallback(
    (clientId) => {
      activeLabelsRef.current.add(clientId);
      const timers = labelTimersRef.current;
      if (timers.has(clientId)) {
        clearTimeout(timers.get(clientId));
      }
      timers.set(
        clientId,
        setTimeout(() => {
          activeLabelsRef.current.delete(clientId);
          timers.delete(clientId);
          renderRemoteCursorStyles();
        }, 2500)
      );
    },
    [renderRemoteCursorStyles]
  );

  /**
   * Handle awareness changes: surface the name tag for users who just moved or
   * typed, drop bookkeeping for users who left, then re-render.
   * @param {{added: number[], updated: number[], removed: number[]}} change - Awareness change.
   * @returns {void}
   */
  const handleAwarenessChange = useCallback(
    ({ added = [], updated = [], removed = [] }) => {
      const doc = docRef.current;
      if (doc) {
        [...added, ...updated].forEach((clientId) => {
          if (clientId !== doc.clientID) {
            markRemoteActive(clientId);
          }
        });
      }
      removed.forEach((clientId) => {
        const timers = labelTimersRef.current;
        if (timers.has(clientId)) {
          clearTimeout(timers.get(clientId));
          timers.delete(clientId);
        }
        activeLabelsRef.current.delete(clientId);
      });
      renderRemoteCursorStyles();
    },
    [markRemoteActive, renderRemoteCursorStyles]
  );

  const updateCursorLine = useCallback((lineNumber) => {
    if (!awarenessRef.current || !user) {
      return;
    }
    if (cursorLineRef.current === lineNumber) {
      return;
    }
    cursorLineRef.current = lineNumber;
    awarenessRef.current.setLocalStateField("cursorLine", lineNumber);
  }, [user]);

  const setLocalTyping = useCallback(() => {
    if (!awarenessRef.current || !user) {
      return;
    }

    if (!isTypingRef.current) {
      awarenessRef.current.setLocalStateField("cursorLine", cursorLineRef.current);
      awarenessRef.current.setLocalStateField("typing", true);
      isTypingRef.current = true;
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      if (awarenessRef.current) {
        awarenessRef.current.setLocalStateField("typing", false);
      }
      isTypingRef.current = false;
    }, 1200);
  }, [user]);

  useEffect(() => {
    if (!socket || !docRef.current || !awarenessRef.current) {
      return;
    }

    const doc = docRef.current;
    const awareness = awarenessRef.current;

    const sendStateVector = () => {
      if (!docRef.current) return;
      const vector = Y.encodeStateVector(docRef.current);
      socket.emit("sync:state-vector", {
        documentId,
        stateVector: encodeUpdate(vector)
      });
    };

    const handleFull = (payload) => {
      if (payload.documentId !== documentId || !docRef.current) return;
      const update = decodeUpdate(payload.update);
      Y.applyUpdate(docRef.current, update, "remote");
      if (payload.awareness && awarenessRef.current) {
        const awarenessUpdate = decodeUpdate(payload.awareness);
        applyAwarenessUpdate(awarenessRef.current, awarenessUpdate, "remote");
      }
      emitTypingUsers();
      scheduleContentNotify();
    };

    const handleUpdate = (payload) => {
      if (payload.documentId !== documentId || !docRef.current) return;
      const update = decodeUpdate(payload.update);
      Y.applyUpdate(docRef.current, update, "remote");
      scheduleContentNotify();
    };

    const handleAwareness = (payload) => {
      if (payload.documentId !== documentId || !awarenessRef.current) return;
      const update = decodeUpdate(payload.update);
      applyAwarenessUpdate(awarenessRef.current, update, "remote");
      emitTypingUsers();
    };

    socket.on("sync:full", handleFull);
    socket.on("sync:update", handleUpdate);
    socket.on("awareness:update", handleAwareness);
    socket.on("connect", sendStateVector);

    sendStateVector();

    return () => {
      socket.off("sync:full", handleFull);
      socket.off("sync:update", handleUpdate);
      socket.off("awareness:update", handleAwareness);
      socket.off("connect", sendStateVector);
    };
  }, [socket, documentId, scheduleContentNotify, emitTypingUsers]);

  useEffect(() => {
    if (!socket || !docRef.current || !awarenessRef.current) {
      return;
    }

    const doc = docRef.current;
    const awareness = awarenessRef.current;

    const handleDocUpdate = (update, origin) => {
      if (origin === "remote") return;
      setLocalTyping();
      socket.emit("sync:update", {
        documentId,
        update: encodeUpdate(update)
      });
      scheduleContentNotify();
    };

    const handleAwarenessUpdate = ({ added, updated, removed }) => {
      if (!awarenessRef.current) return;
      const update = encodeAwarenessUpdate(awarenessRef.current, [...added, ...updated, ...removed]);
      socket.emit("awareness:update", {
        documentId,
        update: encodeUpdate(update)
      });
      emitTypingUsers();
    };

    doc.on("update", handleDocUpdate);
    awareness.on("update", handleAwarenessUpdate);
    awareness.on("change", handleAwarenessChange);
    renderRemoteCursorStyles();

    return () => {
      doc.off("update", handleDocUpdate);
      awareness.off("update", handleAwarenessUpdate);
      awareness.off("change", handleAwarenessChange);
    };
  }, [socket, documentId, scheduleContentNotify, emitTypingUsers, setLocalTyping, renderRemoteCursorStyles, handleAwarenessChange]);

  /**
   * Bind Monaco editor to Yjs document on mount.
   * @param {Object} editor - Monaco editor instance.
   * @returns {void}
   */
  const handleEditorMount = useCallback(
    (editor) => {
      editorRef.current = editor;
      const doc = docRef.current;
      const awareness = awarenessRef.current;
      const model = editor.getModel();
      if (!doc || !awareness || !model) return;

      if (bindingRef.current) {
        bindingRef.current.destroy();
      }

      const yText = doc.getText("content");
      bindingRef.current = new MonacoBinding(yText, model, new Set([editor]), awareness);
      if (cursorListenerRef.current) {
        cursorListenerRef.current.dispose();
      }
      cursorListenerRef.current = editor.onDidChangeCursorPosition((event) => {
        updateCursorLine(event.position.lineNumber);
      });
      const position = editor.getPosition();
      if (position && position.lineNumber) {
        updateCursorLine(position.lineNumber);
      }
      setReady(true);
    },
    [documentId, updateCursorLine]
  );

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/40 shadow-2xl">
      {!ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/80">
          <div className="text-sm text-slate-400">Connecting to editor...</div>
        </div>
      )}
      <Editor
        key={documentId}
        height="100%"
        theme="vs-dark"
        language={language}
        onMount={handleEditorMount}
        options={editorOptions}
        loading={
          <div className="flex h-full items-center justify-center">
            <div className="text-sm text-slate-400">Loading Monaco Editor...</div>
          </div>
        }
      />
    </div>
  );
}
