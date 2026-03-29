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
  const isTypingRef = useRef(false);
  const cursorLineRef = useRef(1);
  const cursorListenerRef = useRef(null);
  const typingDecorationsRef = useRef([]);
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

  const updateTypingDecorations = useCallback(() => {
    const editor = editorRef.current;
    const awareness = awarenessRef.current;
    if (!editor || !awareness) {
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

      decorations.push({
        range: {
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber,
          endColumn: 1
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
      if (onChange) {
        onChange(docRef.current.getText("content").toString());
      }
    };

    const handleUpdate = (payload) => {
      if (payload.documentId !== documentId || !docRef.current) return;
      const update = decodeUpdate(payload.update);
      Y.applyUpdate(docRef.current, update, "remote");
      if (onChange) {
        onChange(docRef.current.getText("content").toString());
      }
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
  }, [socket, documentId, onChange, emitTypingUsers]);

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
      if (onChange && docRef.current) {
        onChange(docRef.current.getText("content").toString());
      }
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

    return () => {
      doc.off("update", handleDocUpdate);
      awareness.off("update", handleAwarenessUpdate);
    };
  }, [socket, documentId, onChange, emitTypingUsers, setLocalTyping]);

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
