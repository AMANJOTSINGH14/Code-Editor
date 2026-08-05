import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { SocketProvider } from "./context/SocketContext.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Editor from "./pages/Editor.jsx";
// AGENT_RUNNER_START
import agentRunnerRoutes from "./features/agent-runner/routes.jsx";
// AGENT_RUNNER_END

/**
 * Guarded route for authenticated pages.
 * @param {Object} props - Component props.
 * @param {React.ReactNode} props.children - Child nodes.
 * @returns {JSX.Element} Route element.
 */
function PrivateRoute({ children }) {
  const { token, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-500 border-t-sky-400" />
          Loading...
        </div>
      </div>
    );
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

/**
 * Redirect authenticated users away from auth pages.
 * @param {Object} props - Component props.
 * @param {React.ReactNode} props.children - Child nodes.
 * @returns {JSX.Element} Route element.
 */
function PublicRoute({ children }) {
  const { token, loading } = useAuth();
  if (loading) return null;
  if (token) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

/**
 * Root application component.
 * @returns {JSX.Element} App component.
 */
export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route
              path="/login"
              element={
                <PublicRoute>
                  <Login />
                </PublicRoute>
              }
            />
            <Route
              path="/register"
              element={
                <PublicRoute>
                  <Register />
                </PublicRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <PrivateRoute>
                  <Dashboard />
                </PrivateRoute>
              }
            />
            <Route
              path="/editor/:id"
              element={
                <PrivateRoute>
                  <Editor />
                </PrivateRoute>
              }
            />
            {/* AGENT_RUNNER_START */}
            {agentRunnerRoutes(PrivateRoute)}
            {/* AGENT_RUNNER_END */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </SocketProvider>
    </AuthProvider>
  );
}
