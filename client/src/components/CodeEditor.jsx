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
 * @returns {JSX.Element} Editor component.
 */
export default function CodeEditor({ documentId, socket, user, language, onChange }) {
  const editorRef = useRef(null);
  const bindingRef = useRef(null);
  const docRef = useRef(null);
  const awarenessRef = useRef(null);
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
  }, [user, documentId]);

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
  }, [socket, documentId, onChange]);

  useEffect(() => {
    if (!socket || !docRef.current || !awarenessRef.current) {
      return;
    }

    const doc = docRef.current;
    const awareness = awarenessRef.current;

    const handleDocUpdate = (update, origin) => {
      if (origin === "remote") return;
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
    };

    doc.on("update", handleDocUpdate);
    awareness.on("update", handleAwarenessUpdate);

    return () => {
      doc.off("update", handleDocUpdate);
      awareness.off("update", handleAwarenessUpdate);
    };
  }, [socket, documentId, onChange]);

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
      setReady(true);
    },
    [documentId]
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
