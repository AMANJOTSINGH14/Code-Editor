import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useAuth } from "./AuthContext.jsx";

const SocketContext = createContext(null);

/**
 * Socket.io provider for real-time features.
 * Maintains a single socket connection and updates auth token without reconnecting.
 * @param {Object} props - Component props.
 * @param {React.ReactNode} props.children - Child nodes.
 * @returns {JSX.Element} Provider element.
 */
export function SocketProvider({ children }) {
  const { token } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const tokenRef = useRef(token);

  tokenRef.current = token;

  useEffect(() => {
    if (!token) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocket(null);
      setConnected(false);
      return;
    }

    if (socketRef.current) {
      socketRef.current.auth = { token };
      return;
    }

    const socketUrl = import.meta.env.VITE_SOCKET_URL || "http://localhost:3001";
    const instance = io(socketUrl, {
      auth: { token },
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    instance.on("connect", () => setConnected(true));
    instance.on("disconnect", () => setConnected(false));
    instance.on("connect_error", () => {
      instance.auth = { token: tokenRef.current };
    });

    socketRef.current = instance;
    setSocket(instance);

    return () => {
      instance.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  const value = useMemo(() => ({ socket, connected }), [socket, connected]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

/**
 * Access the socket context.
 * @returns {Object} Socket context value.
 */
export function useSocketContext() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error("useSocketContext must be used within SocketProvider");
  }
  return context;
}
