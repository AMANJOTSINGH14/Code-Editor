import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api, { setAccessToken, onInterceptorRefresh } from "../services/api.js";

const AuthContext = createContext(null);

/**
 * Authentication provider for the app.
 * @param {Object} props - Component props.
 * @param {React.ReactNode} props.children - Child nodes.
 * @returns {JSX.Element} Provider element.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("accessToken"));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      setAccessToken(token);
    }
  }, [token]);

  useEffect(() => {
    onInterceptorRefresh((newToken, newUser) => {
      setToken(newToken);
      setUser(newUser);
    });
  }, []);

  /**
   * Persist the access token.
   * @param {string} newToken - Access token.
   * @returns {void}
   */
  const persistToken = useCallback((newToken) => {
    localStorage.setItem("accessToken", newToken);
    setToken(newToken);
    setAccessToken(newToken);
  }, []);

  /**
   * Clear the stored access token.
   * @returns {void}
   */
  const clearToken = useCallback(() => {
    localStorage.removeItem("accessToken");
    setToken(null);
    setAccessToken(null);
  }, []);

  /**
   * Register a new user.
   * @param {Object} payload - Registration payload.
   * @returns {Promise<void>} Resolves when complete.
   */
  const register = useCallback(async (payload) => {
    const response = await api.post("/api/auth/register", payload);
    const { user: newUser, accessToken } = response.data.data;
    setUser(newUser);
    persistToken(accessToken);
  }, [persistToken]);

  /**
   * Login an existing user.
   * @param {Object} payload - Login payload.
   * @returns {Promise<void>} Resolves when complete.
   */
  const login = useCallback(async (payload) => {
    const response = await api.post("/api/auth/login", payload);
    const { user: newUser, accessToken } = response.data.data;
    setUser(newUser);
    persistToken(accessToken);
  }, [persistToken]);

  /**
   * Refresh access token silently.
   * @returns {Promise<void>} Resolves when complete.
   */
  const refresh = useCallback(async () => {
    try {
      const response = await api.post("/api/auth/refresh");
      const { user: newUser, accessToken } = response.data.data;
      setUser(newUser);
      persistToken(accessToken);
    } catch {
      clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [persistToken, clearToken]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    if (user) {
      setLoading(false);
      return;
    }
    refresh();
  }, []);

  /**
   * Logout the current user.
   * @returns {void}
   */
  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, [clearToken]);

  const value = useMemo(
    () => ({ user, token, loading, register, login, logout, refresh }),
    [user, token, loading, register, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Access the authentication context.
 * @returns {Object} Auth context value.
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
