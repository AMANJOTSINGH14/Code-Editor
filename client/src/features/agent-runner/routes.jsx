import React, { Suspense, lazy } from "react";
import { Route } from "react-router-dom";

/**
 * Agent Runner routes.
 *
 * Exported as a single element so App.jsx needs only one import and one
 * expression inside <Routes> — keeping the touch point on that file minimal, and
 * letting the whole feature be removed by deleting two marked lines.
 *
 * Lazily loaded so the runner's bundle (including Monaco's diff editor) is not
 * downloaded by users who never open /runs.
 */

const RunsPage = lazy(() => import("./RunsPage.jsx"));
const RunDetailPage = lazy(() => import("./RunDetailPage.jsx"));

/**
 * Suspense wrapper matching the app's existing loading treatment.
 * @param {Object} props - Component props.
 * @param {React.ReactNode} props.children - Lazy element.
 * @returns {JSX.Element} Wrapped element.
 */
function Lazy({ children }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="flex items-center gap-3 text-slate-400">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-500 border-t-sky-400" />
            Loading...
          </div>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

/**
 * Build the runner's routes, wrapped in the app's auth guard.
 * @param {React.ComponentType} PrivateRoute - The app's auth guard component.
 * @returns {JSX.Element} Route fragment.
 */
export default function agentRunnerRoutes(PrivateRoute) {
  return (
    <>
      <Route
        path="/runs"
        element={
          <PrivateRoute>
            <Lazy>
              <RunsPage />
            </Lazy>
          </PrivateRoute>
        }
      />
      <Route
        path="/runs/:id"
        element={
          <PrivateRoute>
            <Lazy>
              <RunDetailPage />
            </Lazy>
          </PrivateRoute>
        }
      />
    </>
  );
}
